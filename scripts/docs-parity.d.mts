export declare function plainText(source: string): string;
export declare function ciNodeMatrix(ciYaml: string): number[] | null;
export declare function ciOperatingSystems(ciYaml: string): Set<string>;
export declare function enginesFloor(range: string | undefined): number | null;
export interface NodeClaimOptions {
  matrix: number[];
  oses: Set<string>;
  floor: number;
  requireList: boolean;
  requireFloor: boolean;
}
export declare function checkNodeClaims(
  file: string,
  source: string,
  opts: NodeClaimOptions,
): string[];
export declare function checkExitCodeDenials(
  file: string,
  source: string,
  codes: Set<number>,
): string[];
