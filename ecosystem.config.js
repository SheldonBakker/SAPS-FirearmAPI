module.exports = {
    apps: [{
        name: "firearm-api",
        script: "app.js",
        instances: "max",
        exec_mode: "cluster",
        autorestart: true
    }]
}
