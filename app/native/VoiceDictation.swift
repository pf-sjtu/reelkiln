import AVFoundation
import Foundation
import Speech

// SpeechAnalyzer stays on-device, including when it downloads Apple's language assets.
// Do not fall back to SFSpeechRecognizer or a hosted transcription service.
@main struct VoiceDictation {
    static func reply(_ value: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: value) {
            FileHandle.standardOutput.write(data)
        }
    }

    static func main() async {
        guard #available(macOS 26, *) else { reply(["error": "unsupported_os"]); return }
        guard SpeechTranscriber.isAvailable else { reply(["error": "unavailable"]); return }
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) else {
            reply(["error": "unsupported_language"]); return
        }
        if CommandLine.arguments.dropFirst() == ["--check"] { reply(["available": true]); return }
        guard CommandLine.arguments.count == 2,
              let file = try? AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1])),
              file.length > 0, Double(file.length) / file.processingFormat.sampleRate <= 120.1 else {
            reply(["error": "invalid_audio"]); return
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        do {
            // Reserve only this language so Apple's shared model remains available between notes.
            try await AssetInventory.reserve(locale: locale)
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await request.downloadAndInstall()
            }
        } catch { reply(["error": "model_download"]); return }
        do {
            let analyzer = SpeechAnalyzer(modules: [transcriber])
            async let analysis: Void = analyzer.start(inputAudioFile: file, finishAfterFile: true)
            var text = ""
            for try await result in transcriber.results {
                text += String(result.text.characters)
            }
            try await analysis
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            reply(trimmed.isEmpty ? ["error": "no_speech"] : ["text": trimmed])
        } catch { reply(["error": "transcription_failed"]) }
    }
}
