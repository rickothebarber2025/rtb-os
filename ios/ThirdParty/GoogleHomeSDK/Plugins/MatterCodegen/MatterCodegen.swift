import Foundation
import PackagePlugin

/// A Swift Package Manager `CommandPlugin` for generating Trait classes from a Matter IDL.
@main
struct Codegen: CommandPlugin {

  /// The entry point for the command plugin.
  ///
  /// This method is called by Swift Package Manager when the `matter-codegen` command is invoked.
  /// It sets up the environment, parses arguments, and runs the Python-based code generator.
  ///
  /// - Parameters:
  ///   - context: The plugin context, providing access to package information and tools.
  ///   - arguments: The command-line arguments passed to the plugin.
  func performCommand(context: PluginContext, arguments: [String]) async throws {
    let package = context.package.directoryURL
    let venv = URL(filePath: ".matter-codegen", directoryHint: .isDirectory, relativeTo: package)

    // Check if the virtual environment exists.
    guard FileManager.default.fileExists(atPath: venv.path) else {
      Diagnostics.error(
        "Virtual environment does not exist. Did you forget to run `matter-codegen-init`?")
      throw PluginContextError.toolNotSupportedOnTargetPlatform(name: "matter-codegen")
    }

    let python = URL(filePath: "bin/python3", relativeTo: venv)
    let codegen = try context.tool(named: "google_home_codegen.py").url

    guard let idlPath = arguments.last else {
      try Process.exec(python, arguments: [codegen.path, "--help"])
      throw PluginContextError.toolNotSupportedOnTargetPlatform(name: "matter-codegen")
    }

    let idlURL = URL(filePath: idlPath, directoryHint: .notDirectory, relativeTo: package)

    // NOTE: SPM can only write to its sandbox,
    let outputURL = URL(
      filePath: idlURL.lastPathComponent, relativeTo: context.pluginWorkDirectoryURL)

    let cmd = [codegen.path, "--lang", "swift", "--output-dir", outputURL.path, idlURL.path]

    Diagnostics.progress("Generating Swift code from \(idlURL.path).")
    try Process.exec(python, arguments: cmd, directoryURL: codegen.deletingLastPathComponent())

    Diagnostics.progress(
      [
        "✅ Codegen complete!",
        "To view the generated files run:",
        "open \(outputURL.absoluteString)\n",
      ].joined(separator: "\n\n\t"))
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
    try exec(executable, arguments: arguments)
  }

  /// Executes a command with the given arguments.
  /// - Parameters:
  ///   - executable: The URL of the executable to run.
  ///   - arguments: An array of string arguments for the command.
  /// - Throws: An error if the process fails to run or exits with a non-zero status.
  static func exec(_ executable: URL, arguments: [String], directoryURL: URL? = nil) throws {
    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    process.currentDirectoryURL = directoryURL
    try process.run()
    process.waitUntilExit()

    if process.terminationStatus != 0 {
      Diagnostics.error(
        "Process failed to run: \(executable.path) \(arguments.joined(separator: " "))")
      throw PluginContextError.toolNotSupportedOnTargetPlatform(name: "matter-codegen")
    }
  }
}
