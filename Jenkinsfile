```groovy
stage('OWASP Dependency-Check: SCA') {
    options {
        timeout(time: 2, unit: 'HOURS')
    }

    steps {
        sh '''
            set -eu

            echo "Starting OWASP Dependency-Check..."

            mkdir -p odc-reports
            mkdir -p /var/lib/jenkins/odc-data

            docker run --rm \
                -u "$(id -u):$(id -g)" \
                -e HOME=/tmp \
                -e JAVA_OPTS=-Xmx2g \
                -v "$WORKSPACE:/src" \
                -v /var/lib/jenkins/odc-data:/odc-data \
                owasp/dependency-check:12.1.0 \
                --scan /src/backend/target/*.jar \
                --scan /src/frontend/package-lock.json \
                --data /odc-data \
                --out /src/odc-reports \
                --format HTML \
                --format JSON \
                --disableNodeAudit \
                --disableOssIndex \
                --nvdMaxRetryCount 20 \
                --nvdApiDelay 10000

            echo "Dependency-Check completed successfully."
        '''
    }

    post {
        always {
            archiveArtifacts(
                artifacts: 'odc-reports/**',
                allowEmptyArchive: true
            )
        }
    }
}
```
