"""A front-end for the Matter code generator.

This script parses pragmas from the header of a Matter IDL file and uses them
to invoke the underlying `matter.codegen` tool with the appropriate options.
"""

import argparse
import re
import sys
from typing import TextIO

from matter import codegen as codegen_tool


def _parse_pragmas(idl: TextIO, lang: str) -> dict[str, str]:
  """Scans the header of an IDL file for pragmas and parses them.

  The function reads the initial contiguous block of lines starting with '//'.
  It stops as soon as a non-comment line is found. Within that block, it
  looks for lines matching the format:
      // pragma $lang(key=value, key2="value 2", ...)

  Args:
      idl: The path to the file to scan.
      lang: The language pragma to parse. Only pragmas matching this language
        will be included.

  Returns:
      A dictionary of parsed pragma options.
  """
  # Regex to find a pragma line and capture its name and arguments string
  # Captures: lang, kwargs
  pragma_line_re = re.compile(
      r"^\s*//\s*pragma\s+(?P<lang>[a-zA-Z0-9_]+)\s*\((?P<kwargs>.*)\)"
  )

  # Regex to find all key=value pairs within the arguments string
  # Captures: key, value (which can be quoted or unquoted)
  kwargs_re = re.compile(
      r"(?P<key>[a-zA-Z_]\w*)\s*=\s*(?P<value>'[^']*'|\"[^\"]*\"|[^,)]+)"
  )

  options: dict[str, str] = {}

  with idl as f:
    for line in f:
      stripped_line = line.strip()

      # Skip empty lines
      if not stripped_line:
        continue

      # Stop scanning if we're past the initial comment block
      if not stripped_line.startswith("//"):
        break

      # Check if the line matches the pragma format
      match = pragma_line_re.match(stripped_line)
      if not match:
        continue

      # Check if the pragma name matches the requested language.
      pragma_name = match.group("lang")
      if pragma_name != lang:
        continue

      # Find all key=value pairs in the arguments string
      kwargs_string = match.group("kwargs")
      for kwarg_match in kwargs_re.finditer(kwargs_string):
        key = str(kwarg_match.group("key")).strip()
        value = str(kwarg_match.group("value")).strip()
        options[key] = value

  return options


def main() -> None:
  """Main function for the code generator."""
  parser = argparse.ArgumentParser(description="""
        Front end for the Matter code generator.

        Parses pragmas from the IDL file header and passes them to the code generator.

        The pragma format is:

        // pragma <language>(<option>=<value>, <option2>=<value2>, ...)

        where <language> is the language to generate code for, and <option>s are
        options to pass to the code generator.
      """)
  parser.add_argument(
      "-l",
      "--lang",
      type=str,
      choices=["cpp", "kotlin", "swift"],
      help="The language to generate code for.",
      required=True,
  )
  parser.add_argument(
      "-o",
      "--output-dir",
      type=str,
      required=True,
      help="The directory to write the generated files to.",
  )
  parser.add_argument(
      "--option",
      action="append",
      help="Options to pass to the code generator (e.g. --option key:value).",
  )
  parser.add_argument(
      "idl_file",
      type=argparse.FileType("r"),
      help="The name of the IDL file to process.",
  )
  args = parser.parse_args()

  # Parse the pragmas from the IDL file header.
  options = _parse_pragmas(args.idl_file, args.lang)

  # Invoke the code generator with the parsed options and the IDL file.
  cmd = [
      "codegen.py",
      "--generator",
      f"custom:.:{args.lang}",
      "--output-dir",
      args.output_dir,
  ]
  if args.option:
    for opt in args.option:
      cmd.append("--option")
      cmd.append(opt)
  for key, value in options.items():
    cmd.append("--option")
    cmd.append(f"{key}:{value}")
  cmd.append(args.idl_file.name)

  sys.argv = cmd
  codegen_tool.main()


if __name__ == "__main__":
  main()
