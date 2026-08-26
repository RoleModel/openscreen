import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
	mainSidebar: [
		{
			// RoleModel's own pages, synced from the rolemodel-openscreen repo by
			// `npm run sync-docs` there — edit them in that repo, not here. First in
			// the sidebar because for anyone on this team they are the entry point:
			// upstream's Getting Started installs upstream's app.
			type: "category",
			label: "RoleModel pipeline",
			collapsible: false,
			items: ["rolemodel/using-the-studio", "rolemodel/development", "rolemodel/agents"],
		},
		{
			type: "category",
			label: "Getting Started",
			collapsible: false,
			items: ["intro", "installation", "quick-start"],
		},
		{
			type: "category",
			label: "Features",
			collapsible: false,
			items: ["recording", "media-library", "editing-timeline", "captions", "ai-editing", "export"],
		},
		{
			type: "category",
			label: "Community",
			collapsible: false,
			items: [
				{
					type: "link",
					label: "Contributing",
					href: "https://github.com/getopenscreen/openscreen/blob/main/CONTRIBUTING.md",
				},
				{
					type: "link",
					label: "Roadmap",
					href: "https://github.com/getopenscreen/openscreen/blob/main/ROADMAP.md",
				},
			],
		},
	],
};

export default sidebars;
