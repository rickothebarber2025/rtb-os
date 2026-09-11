# Google Home Codegen

Tool to generate code for integrating custom Matter clusters
with the Google Home SDK.

## Installation

```shell
python3 -m venv .venv
.venv/bin/pip install .
```

## Usage

```shell
.venv/bin/python3 google_home_codegen.py --help

usage: google_home_codegen.py [-h] -l {cpp,kotlin,swift} -o OUTPUT_DIR [--option OPTION] idl_file

Front end for the Matter code generator. Parses pragmas from the IDL file header and passes them to the code generator. The pragma format is: // pragma
<language>(<option>=<value>, <option2>=<value2>, ...) where <language> is the language to generate code for, and <option>s are options to pass to the code
generator.

positional arguments:
  idl_file              The name of the IDL file to process.

options:
  -h, --help            show this help message and exit
  -l, --lang {cpp,kotlin,swift}
                        The language to generate code for.
  -o, --output-dir OUTPUT_DIR
                        The directory to write the generated files to.
  --option OPTION       Options to pass to the code generator (e.g. --option key:value).
```