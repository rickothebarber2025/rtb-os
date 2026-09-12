// swift-tools-version: 6.1
//
// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import PackageDescription

// swift-format-ignore: AlwaysUseLowerCamelCase
let __MINIMUM_IOS_VERSION__ = "17.0"

let package = Package(
  name: "GoogleHomeSDK",
  platforms: [.iOS(__MINIMUM_IOS_VERSION__)],
  products: [
    .library(name: "GoogleHomeSDK", type: .static, targets: ["GoogleHomeSDKTarget"]),
    .library(name: "GoogleHomeTypes", type: .static, targets: ["GoogleHomeTypesTarget"]),
  ],
  dependencies: [],
  targets: [
    .binaryTarget(
      name: "GoogleHomeSDKBinary",
      path: "Frameworks/GoogleHomeSDK.xcframework",
    ),
    .binaryTarget(
      name: "GoogleHomeTypesBinary",
      path: "Frameworks/GoogleHomeTypes.xcframework",
    ),
    .binaryTarget(
      name: "MatterCodegenTool",
      path: "Tools/matter_codegen.artifactbundle",
    ),
    .target(
      name: "GoogleHomeSDKTarget",
      dependencies: ["GoogleHomeSDKBinary"],
      linkerSettings: [
        .linkedLibrary("c++"),
        .linkedLibrary("sqlite3"),
        .linkedLibrary("z"),
        .linkedFramework("Combine"),
        .linkedFramework("CryptoKit"),
        .linkedFramework("Foundation"),
        .linkedFramework("Matter"),
        .linkedFramework("UIKit"),
      ]
    ),
    .target(
      name: "GoogleHomeTypesTarget",
      dependencies: ["GoogleHomeTypesBinary"],
      linkerSettings: [
        .linkedFramework("Foundation")
      ]
    ),
    .testTarget(
      name: "GoogleHomeSDKTests",
      dependencies: ["GoogleHomeSDKTarget", "GoogleHomeTypesTarget"],
      plugins: [.plugin(name: "MatterCodegenPlugin")]
    ),
    .plugin(
      name: "MatterCodegenPlugin",
      capability: .buildTool(),
      dependencies: ["MatterCodegenTool"],
      path: "Plugins/MatterCodegen",
      sources: ["MatterCodegenPlugin.swift"],
    ),
    .plugin(
      name: "MatterCodegenInit",
      capability: .command(
        intent: .custom(
          verb: "matter-codegen-init",
          description: "Sets up the local Python virtual environment."
        )
      ),
      dependencies: ["MatterCodegenTool"],
      path: "Plugins/MatterCodegen",
      sources: ["MatterCodegenInit.swift"],
    ),
    .plugin(
      name: "MatterCodegen",
      capability: .command(
        intent: .custom(
          verb: "matter-codegen",
          description: "Generates custom traits from a Matter IDL."
        )
      ),
      dependencies: ["MatterCodegenTool"],
      path: "Plugins/MatterCodegen",
      sources: ["MatterCodegen.swift"],
    ),
  ]
)
