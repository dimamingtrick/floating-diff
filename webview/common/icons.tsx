import type { JSX } from 'preact';

/** Stroke icons from the design (16×16 grid, currentColor), sized like VS Code's. */
function Svg({ size = 14, children, className }: { size?: number; children: JSX.Element | JSX.Element[]; className?: string }) {
	return (
		<svg class={`ic ${className ?? ''}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
			{children}
		</svg>
	);
}

type IconProps = { size?: number; className?: string };

export const BranchIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M5 3.6v8.8" />
		<circle cx="5" cy="2.4" r="1.5" />
		<circle cx="5" cy="13.6" r="1.5" />
		<circle cx="11" cy="4.6" r="1.5" />
		<path d="M11 6.2c0 3.2-6 2.1-6 5.6" />
	</Svg>
);

export const TagIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M7.6 2.2H13v5.4l-6 6-5.4-5.4z" />
		<circle cx="10.4" cy="5" r="1" />
	</Svg>
);

export const SearchIcon = (p: IconProps) => (
	<Svg {...p}>
		<circle cx="7" cy="7" r="4.2" />
		<path d="M10.2 10.2 14 14" />
	</Svg>
);

export const EyeIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M1.6 8s2.4-4.2 6.4-4.2S14.4 8 14.4 8s-2.4 4.2-6.4 4.2S1.6 8 1.6 8z" />
		<circle cx="8" cy="8" r="1.7" />
	</Svg>
);

export const MoreIcon = (p: IconProps) => (
	<Svg {...p}>
		<circle cx="3.2" cy="8" r=".9" fill="currentColor" />
		<circle cx="8" cy="8" r=".9" fill="currentColor" />
		<circle cx="12.8" cy="8" r=".9" fill="currentColor" />
	</Svg>
);

export const ChevronDown = (p: IconProps) => (
	<Svg {...p}>
		<path d="M4 6.5 8 10.5l4-4" />
	</Svg>
);

export const ChevronRight = (p: IconProps) => (
	<Svg {...p}>
		<path d="M6 3.5 10.5 8 6 12.5" />
	</Svg>
);

export const FileIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M4 1.8h5l3 3v9.4H4z" />
		<path d="M9 1.8v3.2h3" />
	</Svg>
);

export const FolderIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M2 3.5h4l1.2 1.6H14v7.4H2z" />
	</Svg>
);

export const CommitIcon = (p: IconProps) => (
	<Svg {...p}>
		<circle cx="8" cy="8" r="3" />
		<path d="M1.6 8h3.4M11 8h3.4" />
	</Svg>
);

export const RefreshIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M13 8a5 5 0 1 1-1.6-3.6" />
		<path d="M13.2 2.6v2.6h-2.6" />
	</Svg>
);

export const PlusIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M8 3.5v9M3.5 8h9" />
	</Svg>
);

export const CopyIcon = (p: IconProps) => (
	<Svg {...p}>
		<rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.4" />
		<path d="M3 10.6V3.9A1.4 1.4 0 0 1 4.4 2.5h6.4" />
	</Svg>
);

export const CompareIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M5 2.5v11M11 2.5v11" />
		<path d="M2.6 5.2 5 2.8l2.4 2.4M8.6 10.8 11 13.2l2.4-2.4" />
	</Svg>
);

export const ListIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M3 4h10M3 8h10M3 12h10" />
	</Svg>
);

export const TreeIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M3 3.5h4M5 3.5v9M5 8h4.5M5 12.5h4.5" />
	</Svg>
);

export const CloudIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M4.6 12.5h7a2.7 2.7 0 0 0 .3-5.4 4 4 0 0 0-7.7-.6A3 3 0 0 0 4.6 12.5z" />
	</Svg>
);
