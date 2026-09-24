# Third-party notices

NodePeek's original code is licensed under MIT. Third-party components retain their own licenses.

- **Apache ECharts 5.6.0** is bundled locally in `static/vendor/echarts.min.js` under Apache-2.0. Its full license is included in [ECHARTS-LICENSE.txt](static/vendor/ECHARTS-LICENSE.txt), together with the upstream [NOTICE](static/vendor/ECHARTS-NOTICE.txt). The notice comes from the [5.6.0 source release](https://raw.githubusercontent.com/apache/echarts/5.6.0/NOTICE). Project: <https://echarts.apache.org/>.
- Python dependencies are installed separately from the exact versions in `requirements.lock`; their distribution metadata includes their respective licenses. They are not copied from the developer's virtual environment into release archives.
- Documentation screenshots are generated from NodePeek using entirely synthetic demonstration data. The SVG branding is part of NodePeek.

No external fonts, analytics scripts or CDN resources are required by the dashboard.
