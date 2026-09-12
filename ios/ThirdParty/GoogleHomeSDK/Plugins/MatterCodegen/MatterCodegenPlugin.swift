import Foundation
import PackagePlugin

/// A Swift Package Manager `BuildToolPlugin` for generating Trait classes from a Matter IDL.
@main
struct MatterCodegenPlugin: BuildToolPlugin {

  /// The entry point for the build tool plugin.
  ///
  /// This method is called by Swift Package Manager for each target that uses the plugin.
  /// It creates build commands to generate Swift source files from `.matter` IDL files.
  ///
  /// - Parameters:
  ///   - context: The plugin context, providing access to package information and tools.
  ///   - target: The target for which the build commands should be created.
  /// - Returns: An array of `Command` instances to be executed by the build system.
  /// - Throws: An error if the plugin encounters a problem, such as not finding any `.matter` files.
  func createBuildCommands(context: PluginContext, target: Target) throws -> [Command] {
    Diagnostics.progress("Auto-Generating code not yet implemented. Please generate code manually.")
    return []
  }
}
