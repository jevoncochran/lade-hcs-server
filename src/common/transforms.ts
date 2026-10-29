// class-transformer helpers shared by DTOs.

// Trims surrounding whitespace from string fields: @Transform(trim)
export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
