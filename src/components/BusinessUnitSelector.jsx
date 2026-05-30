import { Building2 } from 'lucide-react';

export default function BusinessUnitSelector({
  businessUnits,
  selectedBusinessUnitId,
  setSelectedBusinessUnitId,
}) {
  return (
    <label className="business-selector">
      <Building2 size={17} />
      <span className="sr-only">Business unit</span>
      <select
        value={selectedBusinessUnitId || ''}
        onChange={(event) => setSelectedBusinessUnitId(event.target.value)}
      >
        {businessUnits.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name}
          </option>
        ))}
      </select>
    </label>
  );
}
