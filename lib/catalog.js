/** Starter maintenance catalog. Category examples are NOT manufacturer-verified. */
export const CATALOG = [
  { id: "dishwasher", name: "Dishwasher", icon: "dishwasher", location: "Kitchen", tasks: [
    { title: "Inspect and clean filter (if serviceable)", days: 30, notes: "Check the model manual first; some units have self-cleaning filters." },
    { title: "Inspect spray arms and door gasket", days: 90, notes: "Check for clogs, debris, and wear. Follow manufacturer instructions." }
  ]},
  { id: "refrigerator", name: "Refrigerator", icon: "refrigerator", location: "Kitchen", tasks: [
    { title: "Inspect and clean door seals", days: 90, notes: "Use model-approved cleaning products." },
    { title: "Check water filter status (if equipped)", days: 180, notes: "Interval varies by filter and usage; confirm the part number." }
  ]},
  { id: "washer", name: "Washing machine", icon: "washing-machine", location: "Laundry", tasks: [
    { title: "Clean washer tub and gasket", days: 30, notes: "Use the machine's cleaning cycle if available." },
    { title: "Inspect hoses for leaks or damage", days: 180, notes: "Shut off supply if you find a leak." }
  ]},
  { id: "dryer", name: "Clothes dryer", icon: "wind", location: "Laundry", tasks: [
    { title: "Clean lint screen", days: 7, notes: "Actually clean after each load; weekly reminder is only a backup." },
    { title: "Inspect dryer exhaust vent", days: 180, notes: "Service frequency depends on vent length, usage and symptoms; consider a qualified professional." }
  ]},
  { id: "hvac", name: "HVAC / furnace", icon: "air-vent", location: "Utility", tasks: [
    { title: "Check HVAC filter", days: 30, notes: "Replacement frequency depends on filter rating, system, pets, and usage." },
    { title: "Arrange seasonal HVAC inspection", days: 180, notes: "Use a licensed technician where needed." }
  ]},
  { id: "water-heater", name: "Water heater", icon: "flame", location: "Utility", tasks: [
    { title: "Review water heater maintenance schedule", days: 365, notes: "Flushing and inspections depend on fuel type and model. Follow manual; do not attempt unsafe work." }
  ]},
  { id: "irrigation", name: "Irrigation system", icon: "droplets", location: "Yard", tasks: [
    { title: "Inspect heads, leaks, and schedule", days: 90, notes: "Adjust for weather and local watering rules." },
    { title: "Check seasonal winterization needs", days: 365, notes: "Timing depends on local freeze conditions and system design." }
  ]},
  { id: "smoke-alarm", name: "Smoke / CO alarm", icon: "shield-check", location: "Safety", tasks: [
    { title: "Test alarm according to its instructions", days: 30, notes: "Inspect label for manufacturing and replacement dates; safety guidance takes priority." }
  ]},
  { id: "air-purifier", name: "Air purifier", icon: "fan", location: "Living room", tasks: [
    { title: "Check and clean pre-filter", days: 30, notes: "Follow model guidance; do not wash filters not designed to be washed." },
    { title: "Review main filter replacement indicator", days: 90, notes: "Confirm filter model, indicator, and manufacturer interval." }
  ]},
  { id: "vacuum", name: "Vacuum cleaner", icon: "sparkles", location: "Storage", tasks: [
    { title: "Check bin, brush, and filters", days: 30, notes: "See the manufacturer's cleaning instructions." }
  ]},
  { id: "range", name: "Oven / range", icon: "cooking-pot", location: "Kitchen", tasks: [
    { title: "Inspect and clean oven and range", days: 90, notes: "Use model-safe cleaners; gas issues require qualified service." }
  ]},
  { id: "coffee-maker", name: "Coffee maker", icon: "coffee", location: "Kitchen", tasks: [
    { title: "Check descaling and cleaning schedule", days: 30, notes: "Water hardness and appliance instructions determine frequency." }
  ]},
  { id: "range-hood", name: "Range hood", icon: "air-vent", location: "Kitchen", tasks: [
    { title: "Inspect hood grease filters", days: 30, notes: "Some filters are washable; charcoal filters may require replacement." }
  ]},
  { id: "garage-door", name: "Garage door", icon: "warehouse", location: "Garage", tasks: [
    { title: "Check safety reversal and door operation", days: 90, notes: "Follow opener manual; spring repairs require professionals." }
  ]},
  { id: "water-filter", name: "Water filtration system", icon: "glass-water", location: "Kitchen", tasks: [
    { title: "Review filter replacement schedule", days: 90, notes: "Replace based on exact filter and rated capacity." }
  ]},
  { id: "other", name: "Other appliance", icon: "package", location: "Home", tasks: [] }
];
export function catalogItem(id) { return CATALOG.find(x => x.id === id) ?? CATALOG[CATALOG.length - 1]; }
