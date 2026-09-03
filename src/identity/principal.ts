// userID is the stable key every allowlist decision is made on; login and displayName are for
// humans and addresses.
export interface Principal {
  readonly userID: string;
  readonly login: string;
  readonly displayName: string;
  readonly nodeID: string;
  readonly nodeName: string;
  readonly caps: Readonly<Record<string, readonly unknown[]>>;
}
