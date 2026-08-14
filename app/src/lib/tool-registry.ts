/**
 * TOOL REGISTRY - Single Source of Truth for Tool Labels
 * 
 * ====================================================================
 * ALL PROOF, OVERLAY, AND PDF LABELS MUST COME FROM THIS REGISTRY.
 * DO NOT HARDCODE TOOL NAMES ANYWHERE ELSE.
 * ====================================================================
 * 
 * This ensures consistent, OS-locked branding across:
 * - Proof sheet headers
 * - Image overlay stamps
 * - PDF generation
 * - Share links
 */

export const TOOL_REGISTRY = {
  colorpro: {
    key: 'colorpro',
    label: 'ColorPro™',
    description: 'Professional color visualization',
  },
  designpanelpro: {
    key: 'designpanelpro',
    label: 'DesignProAI™',
    description: 'AI Design-to-Print production system',
  },
  fadewraps: {
    key: 'fadewraps',
    label: 'FadeWraps™',
    description: 'Fade and gradient designs',
  },
  graphicspro: {
    key: 'graphicspro',
    label: 'GraphicsPro™',
    description: 'Graphic wrap designs',
  },
  approvepro: {
    key: 'approvepro',
    label: 'ApprovePro™',
    description: 'Wrap approval workflow',
  },
  wbty: {
    key: 'wbty',
    label: 'WBTY™',
    description: 'Wrap By The Yard products',
  },
} as const;

export type ToolKey = keyof typeof TOOL_REGISTRY;

/**
 * Get the display label for a tool
 * @param toolKey - The tool key from the registry
 * @returns The branded label (e.g., "ColorPro™")
 */
export function getToolLabel(toolKey: ToolKey): string {
  return TOOL_REGISTRY[toolKey]?.label || 'DesignProAI™';
}

/**
 * Get tool info by key
 * @param toolKey - The tool key from the registry
 * @returns The full tool info object
 */
export function getToolInfo(toolKey: ToolKey) {
  return TOOL_REGISTRY[toolKey];
}

/**
 * Check if a string is a valid tool key
 */
export function isValidToolKey(key: string): key is ToolKey {
  return key in TOOL_REGISTRY;
}

/**
 * Platform label for footer/generic branding
 */
export const PLATFORM_LABEL = 'DesignProAI™';
