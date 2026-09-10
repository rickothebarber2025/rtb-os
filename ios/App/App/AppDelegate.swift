import UIKit
import Capacitor

#if canImport(GoogleHomeSDK)
import GoogleHomeSDK
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

@objc(GoogleHomeBridgePlugin)
public class GoogleHomeBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoogleHomeBridgePlugin"
    public let jsName = "GoogleHomeBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise)
    ]

    private let sharedAppGroup = "group.com.rtbheadquaters.os"

    #if canImport(GoogleHomeSDK)
    private var home: Home?
    #endif

    private func configValue(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return trimmed
    }

    #if canImport(GoogleHomeSDK)
    private func configureHome(clientID: String, teamID: String) {
        Home.configure {
            $0.teamID = teamID
            $0.clientID = clientID
            $0.strictOperationValidation = true
            $0.sharedAppGroup = sharedAppGroup
        }
    }
    #endif

    @objc func status(_ call: CAPPluginCall) {
        let clientID = configValue("GIDClientID")
        let teamID = configValue("GIDTeamID")
        let cloudProjectNumber = configValue("GoogleHomeCloudProjectNumber")

        #if canImport(GoogleHomeSDK)
        if let clientID, let teamID {
            configureHome(clientID: clientID, teamID: teamID)
        }

        Task { @MainActor in
            let restoredHome = await Home.restoreSession()
            if let restoredHome {
                self.home = restoredHome
            }

            call.resolve([
                "native": true,
                "sdkAvailable": true,
                "clientIDConfigured": clientID != nil,
                "teamIDConfigured": teamID != nil,
                "cloudProjectConfigured": cloudProjectNumber != nil,
                "sharedAppGroupConfigured": true,
                "connected": restoredHome != nil,
                "ready": clientID != nil && teamID != nil && cloudProjectNumber != nil
            ])
        }
        #else
        call.resolve([
            "native": true,
            "sdkAvailable": false,
            "clientIDConfigured": clientID != nil,
            "teamIDConfigured": teamID != nil,
            "cloudProjectConfigured": cloudProjectNumber != nil,
            "sharedAppGroupConfigured": true,
            "connected": false,
            "ready": false
        ])
        #endif
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
                configureHome(clientID: clientID, teamID: teamID)
                self.home = try await Home.connect()
                call.resolve(["connected": true])
            } catch {
                call.reject("Google Home authorization failed: \(error.localizedDescription)")
            }
        }
        #else
        call.reject("Google Home iOS SDK is not installed in the Xcode project yet.")
        #endif
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        #if canImport(GoogleHomeSDK)
        Task { @MainActor in
            let activeHome = self.home ?? await Home.restoreSession()
            await activeHome?.disconnect()
            self.home = nil
            call.resolve(["connected": false])
        }
        #else
        call.reject("Google Home iOS SDK is not installed in the Xcode project yet.")
        #endif
    }
}
