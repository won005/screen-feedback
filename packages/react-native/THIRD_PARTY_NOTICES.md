# SitePing

Source: https://github.com/NeosiaNexus/SitePing

Pinned upstream commit: `fd64185eda976c13c2c5e9a5fa20debf077b9004`.

Reused parts: `packages/widget/src/dom/anchor.ts` and `packages/widget/src/dom/resolver.ts`.

Adaptations: portable relative rectangle calculation in the core; semantic anchor lookup across open shadow roots in the web renderer. Removed automatic text context, attribute fingerprinting, generated CSS/XPath, fuzzy matching and arbitrary candidate selection. No SitePing server, dashboard, screenshot engine or diagnostic collector is included.

## MIT License

Copyright (c) 2025 NeosiaNexus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
