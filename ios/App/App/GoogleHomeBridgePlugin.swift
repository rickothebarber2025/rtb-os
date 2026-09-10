import Foundation
import Capacitor

#if canImport(GoogleHomeSDK)
import GoogleHomeSDK
#endif

@objc(GoogleHomeBridgePlugin)
public class GoogleHomeBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoogleHomeBridgePlugin"
    public let jsName = "GoogleHomeBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise)
    ]

    private func configValue(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return trimmed
    }

    @objc func status(_ call: CAPPluginCall) {
        let clientID = configValue("GIDClientID")
        let teamID = configValue("GIDTeamID")
        let cloudProjectNumber = configValue("GoogleHomeCloudProjectNumber")

        #if canImport(GoogleHomeSDK)
        let sdkAvailable = true
        #else
        let sdkAvailable = false
        #endif

        call.resolve([
            "native": true,
            "sdkAvailable": sdkAvailable,
            "clientIDConfigured": clientID != nil,
            "teamIDConfigured": teamID != nil,
            "cloudProjectConfigured": cloudProjectNumber != nil,
            "ready": sdkAvailable && clientID != nil && teamID != nil && cloudProjectNumber != nil
        ])
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let clientID = configValue("GIDClientID"),
              let teamID = configValue("GIDTeamID"),
              configValue("GoogleHomeCloudProjectNumber") != nil else {
            call.reject("Google Home OAuth configuration is incomplete.")
            return
        }

        #if canImport(GoogleHomeSDK)
        Task { @MainActor in
            do {
                Home.configure {
                    $0.teamID = teamID
                    $0.clientID = clientID
                    $0.strictOperationValidation = true
                }
                _ = try await Home.connect()
                call.resolve(["connected": true])
            } catch {
                call.reject("Google Home authorization failed: \(error.localizedDescription)")
            }
        }
        #else
        call.reject("Google Home iOS SDK is not installed in the Xcode project yet.")
        #endif
    }
}
