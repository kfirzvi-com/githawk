export class Color {
    constructor(private readonly hex: string) {
        if (!this.isValidHex(hex)) {
            throw new Error(`Invalid hex color: ${hex}`);
        }
    }

    get value(): string {
        return this.hex;
    }

    private isValidHex(hex: string): boolean {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
    }

    equals(other: Color): boolean {
        return this.hex === other.hex;
    }

    static fromHex(hex: string): Color {
        return new Color(hex);
    }

    // Predefined colors for different branch types
    static readonly MAIN_BLUE = Color.fromHex('#007ACC');
    static readonly DEVELOP_GREEN = Color.fromHex('#28A745');
    static readonly FEATURE_ORANGE = Color.fromHex('#FD7E14');
    static readonly HOTFIX_RED = Color.fromHex('#DC3545');
    static readonly MERGE_ORANGE = Color.fromHex('#FD7E14');
}