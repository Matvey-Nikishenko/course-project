import { BadRequestException, ValidationError } from '@nestjs/common';

function flatten(errors: ValidationError[], parent = ''): { field: string; rules: string[] }[] {
  const out: { field: string; rules: string[] }[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      out.push({ field, rules: Object.values(error.constraints) });
    }
    if (error.children?.length) {
      out.push(...flatten(error.children, field));
    }
  }
  return out;
}

export function validationFactory(errors: ValidationError[]) {
  return new BadRequestException({
    code: 'validation-failed',
    detail: 'Request body failed validation',
    errors: flatten(errors),
  });
}
