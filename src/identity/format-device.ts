// The first label of the node's DNS name, which is how Tailscale shows a machine.
export function formatDevice(nodeName: string): string {
  const [label = ''] = nodeName.split('.');

  return label === '' ? 'unknown' : label.toLowerCase();
}
