/** Additional offline maintenance starter templates. Guidance is general, not model-verified. */
export const EXTRA_CATALOG = [
  { id: "microwave", name: "Microwave", location: "Kitchen", tasks: [
    { title: "Clean interior and inspect door seal", days: 30, notes: "Wipe spills promptly. Follow the manufacturer's cleaning instructions; stop using a unit with a damaged door." }
  ] },
  { id: "freezer", name: "Standalone freezer", location: "Kitchen", tasks: [
    { title: "Inspect freezer gasket and frost buildup", days: 90, notes: "Defrost only when required by your model. Check for damaged seals and unexpected frost." }
  ] },
  { id: "garbage-disposal", name: "Garbage disposal", location: "Kitchen", tasks: [
    { title: "Inspect and clean garbage disposal", days: 30, notes: "Use the manufacturer's safe cleaning method. Disconnect power before any hands-on service." }
  ] },
  { id: "toaster-oven", name: "Toaster / toaster oven", location: "Kitchen", tasks: [
    { title: "Clean crumb tray and inspect buildup", days: 30, notes: "Unplug and allow to cool. Never immerse the appliance; use approved cleaning methods." }
  ] },
  { id: "electric-kettle", name: "Electric kettle", location: "Kitchen", tasks: [
    { title: "Check for limescale and descale if needed", days: 30, notes: "Water hardness affects frequency. Follow the kettle's approved descaling method." }
  ] },
  { id: "robot-vacuum", name: "Robot vacuum", location: "Living room", tasks: [
    { title: "Clean brushes, wheels and sensors", days: 30, notes: "Remove hair and debris as directed by your model's instructions." },
    { title: "Check filter and replacement indicator", days: 90, notes: "Do not wash a filter unless your model explicitly allows it." }
  ] },
  { id: "humidifier", name: "Portable humidifier", location: "Bedroom", tasks: [
    { title: "Clean humidifier tank (while in use)", days: 3, notes: "EPA suggests cleaning portable humidifiers every third day when in use. Empty, dry and refill daily. Disable this reminder while stored.", sourceUrl: "https://www.epa.gov/indoor-air-quality-iaq/use-and-care-home-humidifiers" }
  ] },
  { id: "dehumidifier", name: "Dehumidifier", location: "Utility", tasks: [
    { title: "Check tank, drainage and intake filter", days: 30, notes: "During use, empty water as needed and clean the intake only as directed by the manual." }
  ] },
  { id: "bathroom-fan", name: "Bathroom exhaust fan", location: "Bathroom", tasks: [
    { title: "Clean dust from vent grille", days: 90, notes: "Turn off power before removing covers. Avoid disturbing wiring or ducting." }
  ] },
  { id: "ceiling-fan", name: "Ceiling fan", location: "Living room", tasks: [
    { title: "Clean fan blades and check for wobble", days: 90, notes: "Switch off power before cleaning. Seek qualified assistance for electrical or mounting problems." }
  ] },
  { id: "sump-pump", name: "Sump pump", location: "Basement", tasks: [
    { title: "Inspect sump, discharge and alarm", days: 90, notes: "Follow the manufacturer's safe testing method. Never reach into a powered sump pit." }
  ] },
  { id: "water-softener", name: "Water softener", location: "Utility", tasks: [
    { title: "Check salt level and regeneration status", days: 30, notes: "For salt-based systems only. Check your unit's required salt type and fill level." }
  ] },
  { id: "thermostat", name: "Thermostat", location: "Living room", tasks: [
    { title: "Review heating/cooling schedule", days: 180, notes: "Check comfort settings, batteries if applicable, and unusual operation." }
  ] },
  { id: "security-camera", name: "Home security camera", location: "Exterior", tasks: [
    { title: "Check view, recording health and power", days: 90, notes: "Check obstruction and firmware according to your vendor. Never put credentials in maintenance notes." }
  ] },
  { id: "window-ac", name: "Window / portable AC", location: "Bedroom", tasks: [
    { title: "Check filter and condensate path (in use)", days: 30, notes: "Only when operating. Turn off and follow model-specific filter and drain instructions." }
  ] },
  { id: "leak-sensor", name: "Water leak detector", location: "Utility", tasks: [
    { title: "Test sensor and check battery", days: 90, notes: "Use the sensor's test procedure and check that notifications reach the intended devices." }
  ] }
];

export const GENERAL_REFERENCES = {
  dishwasher: "https://www.whirlpool.com/blog/kitchen/home-maintenance-checklist.html",
  washer: "https://www.whirlpool.com/blog/washers-and-dryers/clean-washing-machine.html",
  dryer: "https://www.whirlpool.com/blog/washers-and-dryers/how-to-clean-a-dryer-vent.html",
  hvac: "https://www.energystar.gov/saveathome/heating-cooling/maintenance-checklist",
  "smoke-alarm": "https://www.usfa.fema.gov/prevention/home-fires/prepare-for-fire/smoke-alarms/",
  humidifier: "https://www.epa.gov/indoor-air-quality-iaq/use-and-care-home-humidifiers"
};
