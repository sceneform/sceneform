module.exports = {
    packagerConfig: {
        asar: true,
        executableName: "Sceneform",
        // Forge picks icon.ico / icon.icns / icon.png by platform.
        icon: "build/icon",
        appBundleId: "com.sceneform.app",
        appCategoryType: "public.app-category.productivity",
        // The packaged app only needs the built Electron main/preload and renderer,
        // build/ (window icon), LICENSE, package.json and production dependencies.
        // dictionaries/ and assets/ are bundled into dist-renderer by Vite.
        ignore: [
            /^\/(?:src|scripts|app|test|dictionaries|out|\.scratch|\.next|dist|docs\.md|CHANGELOG\.md|docs|.*\.tsbuildinfo)(?:\/|$)/,
            /^\/(?:tsconfig.*\.json|vite\.config\.mjs|next\.config\.ts|next-env\.d\.ts|forge\.config\.cjs|\.[^/]+)$/,
        ],
    },
    makers: [
        {
            name: "@electron-forge/maker-squirrel",
            config: {
                name: "Sceneform",
                authors: "Sceneform",
                description: "Sceneform: a free Fountain screenplay IDE",
                setupIcon: "build/icon.ico",
            },
        },
        {
            name: "@electron-forge/maker-dmg",
        },
        {
            name: "@electron-forge/maker-zip",
            platforms: ["darwin"],
        },
        {
            name: "@electron-forge/maker-deb",
            config: {
                options: {
                    // packagerConfig.executableName is "Sceneform"; the installers default to the npm name.
                    bin: "Sceneform",
                    maintainer: "Sceneform",
                    icon: "build/icon.png",
                    categories: ["Office", "WordProcessor"],
                },
            },
        },
        {
            name: "@electron-forge/maker-rpm",
            config: {
                options: {
                    bin: "Sceneform",
                    // Copy of electron-installer-redhat 4.0.0's spec template with one change: %install
                    // copies from %{_topdir}/BUILD/usr, because rpm >= 4.20 (Fedora 41+, Debian 13) runs
                    // %install in a per-package subdirectory of BUILD and the stock template fails there.
                    specTemplate: require("node:path").join(__dirname, "scripts/rpm.spec.ejs"),
                    // rpmbuild requires a License field; see LICENSE.
                    license: "sceneform Source-Available License 1.0",
                    description: "Sceneform: a free Fountain screenplay IDE",
                    icon: "build/icon.png",
                    categories: ["Office", "WordProcessor"],
                },
            },
        },
    ],
};
