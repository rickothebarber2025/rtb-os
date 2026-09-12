import Foundation
import PackagePlugin

/// A Swift Package Manager `CommandPlugin` for setting up the Python virtual environment
/// required by the `MatterCodegen` plugin.
@main
struct CodegenInit: CommandPlugin {

  /// The entry point for the command plugin.
  ///
  /// This method is called by Swift Package Manager when the `matter-codegen-init` command is
  /// invoked. It sets up a Python virtual environment and installs the necessary dependencies for
  /// the code generator. It can also be used to clean up the environment.
  ///
  /// - Parameters:
  ///   - context: The plugin context, providing access to package information and tools.
  ///   - arguments: Arguments passed to the plugin. The only supported argument is "clean".
  func performCommand(context: PluginContext, arguments: [String]) async throws {
    let package = context.package.directoryURL
    let venv = URL(filePath: ".matter-codegen", directoryHint: .isDirectory, relativeTo: package)

    // Check if package is writable.
    guard FileManager.default.isWritableFile(atPath: package.path) else {
      Diagnostics.error(
        "\(package.path) is not writable. Did you forget to add `--allow-writing-to-package-directory`"
      )
      throw PluginContextError.toolNotSupportedOnTargetPlatform(name: "matter-codegen")
    }

    // Is this a `clean`?
    guard arguments.first != "clean" else {
      Diagnostics.progress("Cleaning up Python virtual environment...")
      if FileManager.default.fileExists(atPath: venv.path) {
        try FileManager.default.removeItem(at: venv)
      }
      return
    }

    Diagnostics.progress("Setting up Python virtual environment...")

    // Create the virtual environment if it doesn't exist
    if !FileManager.default.fileExists(atPath: venv.path) {
      let python = try context.tool(named: "python3").url
      try Process.exec(python, "-m", "venv", venv.path)
    }

    let codegen = try context.tool(named: "google_home_codegen.py").url
    let pyproject = codegen.deletingLastPathComponent()
    let pip = URL(filePath: "bin/pip", relativeTo: venv)

    // Install Python dependencies.
    try Process.exec(pip, "install", "--upgrade", "pip")
    try Process.exec(pip, "install", pyproject.path)

    Diagnostics.progress("✅ Python setup complete!")
  }
}

/// A simple helper for running a process.
extension Process {

  /// Executes a command with the given arguments.
  /// - Parameters:
  ///   - executable: The URL of the executable to run.
  ///   - arguments: A variadic list of string arguments for the command.
  /// - Throws: An error if the process fails to run or exits with a non-zero status.
  static func exec(_ executable: URL, _ arguments: String...) throws {
    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    try process.run()
    process.waitUntilExit()

    if process.terminationStatus != 0 {
      Diagnostics.error(
        "Process failed to run: \(executable.path) \(arguments.joined(separator: " "))")
      throw PluginContextError.toolNotSupportedOnTargetPlatform(name: "matter-codegen")
    }
  }
}
