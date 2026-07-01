import { Building2 } from 'lucide-react';

export default function BusinessUnitSelector({
  businessOptions,
  businessUnits,
  selectedBusinessUnitId,
  setSelectedBusinessUnitId,
}) {
  const options = businessOptions?.length ? businessOptions : businessUnits;

  return (
    <label className="business-selector">
      <Building2 size={17} />
      <span className="sr-only">Business access</span>
      <select
        disabled={!options.length}
        value={selectedBusinessUnitId || ''}
        onChange={(event) => setSelectedBusinessUnitId(event.target.value)}
      >
        {options.length ? (
          options.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))
        ) : (
          <option value="">No business access</option>
        )}
      </select>
    </label>
  );
}
