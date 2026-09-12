# Google Home API

Google Home APIs allow developers to integrate with Google Home Ecosystem
through mobile applications.

For more info: https://developers.home.google.com/apis

## Features

-   Permission API: Authenticate your application seamlessly through
    Authentication API, which provides a set of standardized screens and
    functions to request access to structures and devices.

-   Device API: Retrieve states of smart home devices on a structure, modify
    attributes, and issue commands.

-   Structure API: Retrieve the representational graph for a structure, with
    rooms and assigned devices.

-   Commissioning API: Add new matter devices to Google Home Ecosystem.

-   Automation API: Create and schedule household routines that trigger device
    commands based on defined triggers and conditions.

-   Discovery API: Retrieve a list of automations that can be created on a
    structure given the set of devices.

## Matter Codegen

The SDK archive includes a codegen tool for generating custom traits from a
Matter IDL. The tool is also integrated with Swift Package Manager (instructions
below).

The Matter codegen tool has some Python dependencies that need to be installed.
This is a one-time step that should be done after a new SDK version is
downloaded that will set up the tool so that it can run in the Xcode sandbox.

```shell
swift package plugin --allow-network-connections "all" --allow-writing-to-package-directory matter-codegen-init
```

Once set up, the codegen tool can be invoked to generate the desired traits.

```shell
swift package plugin matter-codegen --create_namespace MyProject Clusters/MyCustomCluster.matter
```

## Integrating the SDK

The SDK can be integrated either via Swift Package Manager or CocoaPods. It is
assumed that you have downloaded and unpacked the SDK into
`ThirdParty/GoogleHomeSDK` directory relative to your project root.

### Swift Package Manager

#### (Optional) Verify the Package

```shell
swift package describe
```

```shell
xcodebuild test -scheme GoogleHomeSDK -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.0'
```

#### Add to Xcode Project

1.  Open your App project in Xcode. Ensure you have unpacked the SDK into the
    `ThirdParty/GoogleHomeSDK` directory relative to your project root.
2.  Select "File" > "Add Package Dependencies..." in the menu bar, then select
    "Add Local..." to select the `GoogleHomeSDK` directory.
3.  In the "Add to Target" column, select your app target for both
    `GoogleHomeSDK` and `GoogleHomeTypes`.

##### Workaround for "failed to install" or "did not contain an Info.plist"

Occasionally, Xcode will incorrectly try to embed the static `GoogleHomeTypes`
framework. If this happens, you may need to add the following "Run Script":

```shell
# Force remove the static framework from the built app bundle
# This fixes the "Missing Info.plist" installation error
echo "Removing wrongly embedded static framework..."
rm -rf "${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}/GoogleHomeTypes.framework"
```

1.  In the top toolbar, select your target name and choose "Edit Scheme...".
2.  In the left sidebar, select the arrow next to "Build" to expand it. Then,
    select "Post-actions".
3.  Select the + button to add a "New Run Script Action", and for "Provide build
    settings from", select your app target.
4.  Paste the above script.
5.  Close the window, select your app target's "Build Phases" tab. Then, click
    the "+" icon and choose "New Run Script Phase", and paste the above script.
6.  Make sure to uncheck the "based on dependency analysis" box, and set the
    "User Script Sandboxing" build option to "No".

#### Add to another Swift Package

If you are developing another Swift package that needs to depend on
`GoogleHomeSDK`, add `GoogleHomeSDK` as a local package dependency in your
`Package.swift`:

```swift
// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "MyApp",
    dependencies: [
        .package(path: "ThirdParty/GoogleHomeSDK")
    ],
    targets: [
        .target(
            name: "MyApp",
            dependencies: [
                .product(name: "GoogleHomeSDK", package: "GoogleHomeSDK"),
            ]
        )
    ]
)
```

### CocoaPods

#### (Optional) Verify the Pod

```shell
pod lib lint
```

#### Add the SDK to your Podfile

Add the following to your `Podfile`:

```ruby
pod 'GoogleHomeSDK', :path => 'ThirdParty/GoogleHomeSDK', :subspecs => ['SDK', 'Types']
```

Make sure to add `$(inherited)` to the "Other Linker Flags" setting and set the
"User Script Sandboxing" option to "No" within your app target's Build Settings.
Then, run `pod install` from Terminal in the directory that contains the
`Podfile`.

Make sure to always open the `.xcworkspace` file from now on in Xcode.

##### Workaround for "Multiple commands produce”

Occasionally, there's an issue with Xcode and CocoaPods script phases that
causes a build error. To resolve this, add the following line to your Podfile:

```ruby
install! 'cocoapods', :disable_input_output_paths => true
```

### Manual Integration

1.  Open your App project in Xcode.
2.  Drag `GoogleHomeSDK.xcframework` and `GoogleHomeTypes.xcframework` bundles
    into Xcode's Project Navigator.
3.  Select your app target, go to "General" tab, and in "Frameworks, Libraries,
    and Embedded Content" section, make sure that both xcframeworks are present
    and "Embed & Sign" is selected for each.
4.  Go to "Build Phases" tab, expand "Link Binary With Libraries" section, and
    add the following system frameworks and libraries if they are not yet
    present:
    -   `Combine`
    -   `CryptoKit`
    -   `Foundation`
    -   `Matter`
    -   `UIKit`
    -   `libc++`
    -   `libsqlite3`
    -   `libz`
