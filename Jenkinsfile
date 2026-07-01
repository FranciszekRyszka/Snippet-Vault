// Self-hosted Jenkins pipeline — builds SnipVault installers for all three
// desktop platforms in parallel, each on its own labeled agent:
//
//   label "windows" -> Windows PC (Ryzen 7 3700X)  -> .msi + .exe
//   label "macos"   -> MacBook Air M2              -> universal .dmg (Intel + Apple Silicon)
//   label "linux"   -> Oracle Cloud server         -> .deb / .AppImage / .rpm
//
// Each agent needs Node.js >= 22 and Rust (rustup) installed, plus the Tauri
// system prerequisites for its OS (MSVC Build Tools + WebView2 on Windows;
// Xcode Command Line Tools on macOS; webkit2gtk + friends on Linux).
//
// The MacBook must be online, on the VPN, and connected as a Jenkins agent when
// a build runs. Installers are archived as build artifacts on each node.

pipeline {
    agent none
    options {
        timestamps()
        // A slow first Rust compile can take a while; give it room.
        timeout(time: 60, unit: 'MINUTES')
    }
    environment {
        CI = 'true' // stops pnpm from prompting to purge node_modules on a re-run
    }
    stages {
        stage('Build') {
            parallel {
                stage('Linux') {
                    agent { label 'linux' }
                    steps {
                        sh 'npm install -g pnpm@11'
                        sh 'pnpm install --frozen-lockfile'
                        sh 'pnpm tauri build'
                    }
                    post {
                        success {
                            archiveArtifacts artifacts: 'src-tauri/target/release/bundle/deb/*.deb, src-tauri/target/release/bundle/appimage/*.AppImage, src-tauri/target/release/bundle/rpm/*.rpm', fingerprint: true, allowEmptyArchive: true
                        }
                    }
                }
                stage('macOS') {
                    agent { label 'macos' }
                    steps {
                        sh 'npm install -g pnpm@11'
                        sh 'pnpm install --frozen-lockfile'
                        // Universal binary covers both Apple Silicon and Intel Macs.
                        sh 'rustup target add aarch64-apple-darwin x86_64-apple-darwin'
                        sh 'pnpm tauri build --target universal-apple-darwin'
                    }
                    post {
                        success {
                            archiveArtifacts artifacts: 'src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg', fingerprint: true, allowEmptyArchive: true
                        }
                    }
                }
                stage('Windows') {
                    agent { label 'windows' }
                    steps {
                        bat 'npm install -g pnpm@11'
                        bat 'pnpm install --frozen-lockfile'
                        bat 'pnpm tauri build'
                    }
                    post {
                        success {
                            archiveArtifacts artifacts: 'src-tauri/target/release/bundle/msi/*.msi, src-tauri/target/release/bundle/nsis/*.exe', fingerprint: true, allowEmptyArchive: true
                        }
                    }
                }
            }
        }
    }
}
