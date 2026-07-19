export function resolvePartIndex(object, partCount) {
  let current = object;

  while (current) {
    const index = current.userData?.partIndex;
    if (Number.isInteger(index) && index >= 0 && index < partCount) {
      return index;
    }
    current = current.parent;
  }

  return -1;
}
