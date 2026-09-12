"""Common functions for all platform codegens."""


def AttributeDocType(attribute: str) -> str:
  """Checks the cluster attribute type for documentation purposes.

  Args:
    attribute: the attribute to check

  Returns:
    cluster if the attribute is cluster-specific
    global if the attribute is common to all clusters
    suppress if the attribute should be suppressed from documentation
  """

  match attribute:
    case (
        "acceptedCommandList"
        | "attributeList"
        | "clusterRevision"
        | "featureMap"
        | "generatedCommandList"
    ):
      return "global"

    case "eventList":
      return "suppress"

    case _:
      return "cluster"


def OutputAttributeComment(attribute: str) -> str:
  """Outputs a documentation comment for global attributes common to all clusters.

  Args:
    attribute: the global attribute to output documentation for

  Returns:
    the documentation comment for the global attribute
  """

  match attribute:
    case "acceptedCommandList":
      return (
          "/** A list of client-generated commands which are supported by this"
          " cluster server instance. */"
      )
    case "attributeList":
      return (
          "/** A list of the attribute IDs of the attributes supported by the"
          " cluster instance. */"
      )
    case "clusterRevision":
      return (
          "/** The revision of the server cluster specification supported by"
          " the cluster instance. */"
      )
    case "featureMap":
      return (
          "/**  Whether the server supports zero or more optional cluster"
          " features. A cluster feature is a set of cluster elements that are"
          " mandatory or optional for a defined feature of the cluster. If a"
          " cluster feature is supported by the cluster instance, then the"
          " corresponding bit is set to 1, otherwise the bit is set to 0"
          " (zero). */"
      )
    case "generatedCommandList":
      return (
          "/** A list of server-generated commands (server to client) which are"
          " supported by this cluster server instance. */"
      )
    case _:
      return ""


def DocExcludeComment(element: str, level: str, tag_type: str) -> str:
  """Outputs Doxygen /cond and /endcond tags to exclude parts of a file from C++ documentation.

  Args:
    element: the cluster or device type to check for exclusions
    level: at which level the exclusion applies, either "cluster", "device", or
      "inline"
    tag_type: indicates whether the tag is an opening tag or a closing tag,
      either "start" or "end"

  Returns:
    Doxygen tag if the item should be excluded, or an empty string for no tag
  """

  if level not in ["cluster", "device", "inline"]:
    raise ValueError(
        "%s is not a valid value for the level, the only valid values are"
        " 'cluster', 'device', or 'inline'." % level
    )

  if tag_type not in ["start", "end"]:
    raise ValueError(
        "%s is not a valid value for the tag_type, the only valid values are"
        " 'start' or 'end'." % tag_type
    )

  # MAP level, tag, show_in_docs TO appropriate doc string
  tag_map = {
      ("cluster", "start", False): r"/// @cond EXCLUDE_CLUSTER_FROM_DOCS",
      ("cluster", "end", False): r"/// @endcond",
      ("device", "start", False): r"/// @cond EXCLUDE_DEVICE_FROM_DOCS",
      ("device", "end", False): r"/// @endcond",
      ("inline", "start", True): r"/// @cond EXCLUDE_FROM_DOCS",
      ("inline", "end", True): r"/// @endcond",
  }

  show_tag = False
  match level:
    case "cluster":
      show_tag = ShowClusterInDocs(element)
    case "device":
      show_tag = ShowDeviceTypeInDocs(element)
    case "inline":
      show_tag = ShowClusterInDocs(element) or ShowDeviceTypeInDocs(element)

  return tag_map.get((level, tag_type, show_tag), "")


def ShowClusterInDocs(cluster: str) -> bool:
  """Checks if the cluster should be included in developer documentation.

  Note that some clusters are specifically excluded from the Home APIs.
  https://source.corp.google.com/piper///depot/google3/java/com/google/home/platform/traits/permissions/config/protoconf.pi?q=third_party_denied_uddm_trait_type_ids

  Args:
    cluster: the cluster to check

  Returns:
    true if the cluster should be included in documentation
  """

  return cluster in {
      "AccountLogin",
      "Actions",
      "ActivatedCarbonFilterMonitoring",
      "AirQuality",
      "ApplicationBasic",
      "ApplicationLauncher",
      "ArmDisarm",
      "AudioInput",
      "AudioOutput",
      "AvStreamAnalysis",
      "Binding",
      "BooleanState",
      "Brightness",
      "CameraAvStreamManagement",
      "CameraHistory",
      "CameraSnapshot",
      "CameraTimeline",
      "CarbonDioxideConcentrationMeasurement",
      "CarbonMonoxideConcentrationMeasurement",
      "Channel",
      "Chime",
      "ChimeThemes",
      "ClosureControl",
      "ClosureDimension",
      "ColorControl",
      "ConfigurationDone",
      "Cook",
      "ContentLauncher",
      "DishwasherAlarm",
      "DishwasherMode",
      "Dispense",
      "Dock",
      "DoorbellPress",
      "DoorLock",
      "ElevatorControl",
      "ExtendedAirQuality",
      "ExtendedApplicationLauncher",
      "ExtendedChannel",
      "ExtendedColorControl",
      "ExtendedFanControl",
      "ExtendedLevelControl",
      "ExtendedMediaInput",
      "ExtendedMediaPlayback",
      "ExtendedModeSelect",
      "ExtendedOperationalState",
      "ExtendedPowerSource",
      "ExtendedTemperatureControl",
      "ExtendedThermostat",
      "FanControl",
      "Fill",
      "FilterMonitoring",
      "FixedLabel",
      "FlowMeasurement",
      "FormaldehydeConcentrationMeasurement",
      "GeneralDiagnostics",
      "HepaFilterMonitoring",
      "Identify",
      "IlluminanceMeasurement",
      "KeypadInput",
      "LaundryWasherControls",
      "LaundryWasherMode",
      "LeafWetnessMeasurement",
      "LevelControl",
      "LightEffects",
      "Locator",
      "LocalizationConfiguration",
      "LockUnlock",
      "LowPower",
      "Max2FilterMonitoring",
      "MediaActivityState",
      "MediaInput",
      "MediaPlayback",
      "ModeSelect",
      "MotionDetection",
      "Mount",
      "NetworkControl",
      "NitrogenDioxideConcentrationMeasurement",
      "ObjectDetection",
      "OccupancySensing",
      "OnOff",
      "OpenClose",
      "OperationalState",
      "OtaSoftwareUpdateRequestor",
      "OzoneConcentrationMeasurement",
      "ParkingLocation",
      "Pm10ConcentrationMeasurement",
      "Pm1ConcentrationMeasurement",
      "Pm25ConcentrationMeasurement",
      "PowerSource",
      "PreFilterMonitoring",
      "PressureMeasurement",
      "PumpConfigurationAndControl",
      "PushAvStreamTransport",
      "RadonConcentrationMeasurement",
      "Reboot",
      "RecordingMode",
      "RefrigeratorAlarm",
      "RefrigeratorAndTemperatureControlledCabinetMode",
      "RelativeHumidityControl",
      "RelativeHumidityMeasurement",
      "Rotation",
      "RvcCleanMode",
      "RvcOperationalState",
      "RvcRunMode",
      "ServiceArea",
      "SimplifiedOnOff",
      "SimplifiedThermostat",
      "SoilMoistureMeasurement",
      "SpeedMeasurement",
      "Switch",
      "TargetNavigator",
      "TemperatureControl",
      "TemperatureMeasurement",
      "Thermostat",
      "ThermostatFanControl",
      "ThermostatUserInterfaceConfiguration",
      "ThreadNetworkCapabilities",
      "ThreadNetworkManagement",
      "Timer",
      "Toggles",
      "TotalVolatileOrganicCompoundsConcentrationMeasurement",
      "UnitTesting",
      "UserLabel",
      "Volume",
      "VisitorAnnouncement",
      "WakeOnLan",
      "WebRtcLiveView",
      "WindowCovering",
      "ZoneManagement",
      # Matter 1.3 additions
      "BooleanStateConfiguration",
      "ContentControl",
      "ContentAppObserver",
      "DeviceEnergyManagement",
      "DeviceEnergyManagementMode",
      "ElectricalPowerMeasurement",
      "ElectricalEnergyMeasurement",
      "EnergyEvse",
      "EnergyEvseMode",
      "EnergyPreference",
      "LaundryDryerControls",
      "Messages",
      "MicrowaveOvenMode",
      "MicrowaveOvenControl",
      "OvenCavityOperationalState",
      "OvenMode",
      "PowerTopology",
      "ValveConfigurationAndControl",
      # Utility traits
      "BasicInformation",
      "Descriptor",
      "ExtendedBasicInformation"
  }


def ShowDeviceTypeInDocs(device_type: str) -> bool:
  """Checks to see if the device type should be included in documentation.

  Args:
    device_type: the device_type to check

  Returns:
    true if the device_type should be included in documentation
  """

  return device_type in {
      "Aggregator",
      "Air Purifier",
      "Air Quality Sensor",
      "Basic Video Player",
      "Casting Video Player",
      "Color Temperature Light",
      "Contact Sensor",
      "Content App",
      "Control Bridge",
      "Dimmable Light",
      "Dimmable Plug-In Unit",
      "Dishwasher",
      "Door Lock",
      "Extended Color Light",
      "Fan",
      "Flow Sensor",
      "Generic Switch",
      "Google Air Cooler",
      "Google Audio Video Receiver",
      "Google Auto",
      "Google Bathtub",
      "Google Blender",
      "Google Boiler",
      "Google Border Router",
      "Google Camera",
      "Google Charger",
      "Google Closet",
      "Google Coffee Maker",
      "Google Control Panel",
      "Google Dehydrator",
      "Google Door",
      "Google Doorbell",
      "Google Drawer",
      "Google Faucet",
      "Google Freezer",
      "Google Fryer",
      "Google Game Console",
      "Google Garage",
      "Google Gate",
      "Google Grill",
      "Google Kettle",
      "Google Mop",
      "Google Mower",
      "Google Multicooker",
      "Google Network",
      "Google Pergola",
      "Google Pet Feeder",
      "Google Pressure Cooker",
      "Google Router",
      "Google Security System",
      "Google Set Top Box",
      "Google Shower",
      "Google Soundbar",
      "Google Sous Vide",
      "Google Sprinkler",
      "Google Standmixer",
      "Google Streaming Box",
      "Google Streaming Soundbar",
      "Google Streaming Stick",
      "Google TV",
      "Google Water Purifier",
      "Google Water Softener",
      "Google Window",
      "Google Yogurtmaker",
      "Heating/Cooling Unit",
      "Humidity Sensor",
      "Laundry Washer",
      "Light Sensor",
      "Mode Select",
      "Occupancy Sensor",
      "On/Off Light",
      "On/Off Plug-in Unit",
      "Pressure Sensor",
      "Pump",
      "Refrigerator",
      "Robotic Vacuum Cleaner",
      "Room Air Conditioner",
      "Root Node",
      "Speaker",
      "Temperature Controlled Cabinet",
      "Temperature Sensor",
      "Thermostat",
      "Video Remote Control",
      "Window Covering",
      # Matter 1.3 additions
      "Casting Video Client",
      "Color Dimmer Switch",
      "Cook Surface",
      "Cooktop",
      "Device Energy Management",
      "Dimmer Switch",
      "Door Lock Controller",
      "Electrical Sensor",
      "Energy Evse",
      "Extractor Hood",
      "Laundry Dryer",
      "Microwave Oven",
      "On/Off Sensor",
      "Ota Requestor",
      "Ota Provider",
      "Oven",
      "Power Source",
      "Pump Controller",
      "Rain Sensor",
      "Water Freeze Detector",
      "Water Leak Detector",
      "Water Valve",
      "Window Covering Controller",
      # Matter 1.5 additions
      "Chime",
      "Closure",
      "Closure Controller",
      "Closure Panel",
      "Doorbell",
      "Electrical Energy Tariff",
      "Electrical Meter",
      "Electrical Utility Meter",
      "Irrigation System",
      "Soil Sensor",
  }


