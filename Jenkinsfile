
pipeline {
  agent any

  parameters {
    booleanParam(
      name: 'DEPLOY',
      defaultValue: false,
      description: 'Deploy Inventory Management application to K3s'
    )

    booleanParam(
      name: 'MONITOR',
      defaultValue: false,
      description: 'Install Prometheus and Grafana monitoring'
    )

    booleanParam(
      name: 'RUN_ZAP',
      defaultValue: false,
      description: 'Run OWASP ZAP DAST scan after deployment'
    )
  }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    SONAR_HOST_URL = 'http://127.0.0.1:9000'
    K3S_CONFIG = '/var/lib/jenkins/.kube/config'

    K3S_NAMESPACE = 'inventory'
    MONITORING_NAMESPACE = 'monitoring'

    BACKEND_IMAGE = 'inventory-backend'
    FRONTEND_IMAGE = 'inventory-frontend'

    TERRAFORM_DIR = 'devsecops/terraform'
    MONITORING_DIR = 'devsecops/monitoring'
  }

  stages {

    // ==========================================
    // 1. PREFLIGHT
    // ==========================================

    stage('Preflight: Check tools and folders') {
      steps {
        sh '''
          set -eu

          echo "Checking project folders..."

          test -d backend
          test -d frontend
          test -d k8s
          test -d "$TERRAFORM_DIR"

          echo "Checking Docker..."

          command -v docker
          command -v curl

          docker info >/dev/null

          if [ "${DEPLOY}" = "true" ] || [ "${MONITOR}" = "true" ]; then

            test -f "$K3S_CONFIG" || {
              echo "K3s kubeconfig missing: $K3S_CONFIG"
              exit 1
            }

            command -v kubectl

            export KUBECONFIG="$K3S_CONFIG"

            kubectl get nodes
          fi

          if [ "${MONITOR}" = "true" ]; then

            test -d "$MONITORING_DIR" || {
              echo "Monitoring directory missing: $MONITORING_DIR"
              exit 1
            }

            test -f "$MONITORING_DIR/k8s-monitoring-values.yaml" || {
              echo "Monitoring values file missing."
              exit 1
            }

            command -v helm
          fi

          echo "Preflight checks passed."
        '''
      }
    }

    // ==========================================
    // 2. GITLEAKS
    // ==========================================

    stage('Gitleaks: Secret Scan') {
      steps {
        sh '''
          set -eu

          docker run --rm \
            -u "$(id -u):$(id -g)" \
            -e HOME=/tmp \
            -v "$PWD":/repo \
            ghcr.io/gitleaks/gitleaks:v8.24.2 \
            git /repo \
            --redact \
            --verbose
        '''
      }
    }

    // ==========================================
    // 3. MAVEN BACKEND BUILD
    // ==========================================

    stage('Maven: Backend Build and Tests') {
      steps {
        sh '''
          set -eu

          docker run --rm \
            -u "$(id -u):$(id -g)" \
            -e HOME=/tmp \
            -e SPRING_DATASOURCE_URL="jdbc:h2:mem:ci;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE" \
            -e SPRING_DATASOURCE_USERNAME="sa" \
            -e SPRING_DATASOURCE_PASSWORD="" \
            -v "$PWD/backend":/app \
            -w /app \
            maven:3.9-eclipse-temurin-17 \
            mvn -B -Duser.home=/tmp clean verify
        '''
      }

      post {
        always {
          junit(
            allowEmptyResults: true,
            testResults: 'backend/target/surefire-reports/*.xml'
          )
        }
      }
    }

    // ==========================================
    // 4. FRONTEND BUILD AND TEST
    // ==========================================

    stage('npm: Frontend Tests and Build') {
      steps {
        sh '''
          set -eu

          docker run --rm \
            -u "$(id -u):$(id -g)" \
            -e HOME=/tmp \
            -e CI=true \
            -v "$PWD/frontend":/app \
            -w /app \
            node:22 \
            sh -c "npm ci --no-audit --no-fund && npm run test:ci && npm run build"
        '''
      }
    }

    // ==========================================
    // 5. SONARQUBE
    // ==========================================

    stage('SonarQube: SAST') {
      steps {
        withCredentials([
          string(
            credentialsId: 'sonarqube-token',
            variable: 'SONAR_TOKEN'
          )
        ]) {
          sh '''
            set -eu

            docker run --rm \
              --network host \
              -u "$(id -u):$(id -g)" \
              -e SONAR_TOKEN \
              -e SONAR_USER_HOME=/tmp/.sonar \
              -v "$PWD":/usr/src \
              sonarsource/sonar-scanner-cli:11 \
              -Dsonar.host.url="$SONAR_HOST_URL" \
              -Dsonar.working.directory=/tmp/scannerwork-run \
              -Dsonar.qualitygate.wait=true
          '''
        }
      }
    }

    // ==========================================
    // 6. OWASP DEPENDENCY CHECK
    // ==========================================

    stage('OWASP Dependency-Check: SCA') {
      options {
        timeout(time: 120, unit: 'MINUTES')
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
            -v "$PWD":/src \
            -v /var/lib/jenkins/odc-data:/odc-data \
            owasp/dependency-check:12.1.0 \
            --scan "/src/backend/target/*.jar" \
            --scan /src/frontend/package-lock.json \
            --data /odc-data \
            --out /src/odc-reports \
            --format HTML \
            --format JSON \
            --disableNodeAudit \
            --disableOssIndex \
            --nvdMaxRetryCount 20

          echo "Dependency-Check completed."
        '''
      }

      post {
        always {
          archiveArtifacts(
            artifacts: 'odc-reports/*',
            allowEmptyArchive: true
          )
        }
      }
    }

    // ==========================================
    // 7. HADOLINT
    // ==========================================

    stage('Hadolint: Dockerfile Lint') {
      steps {
        sh '''
          set -eu

          for file in backend/Dockerfile frontend/Dockerfile; do

            test -f "$file" || {
              echo "Missing Dockerfile: $file"
              exit 1
            }

            echo "Checking $file"

            docker run --rm -i \
              --entrypoint hadolint \
              hadolint/hadolint:latest-debian \
              --failure-threshold error \
              - < "$file"

          done

          echo "Hadolint Dockerfile checks completed."
        '''
      }
    }

    // ==========================================
    // 8. DOCKER IMAGE BUILD
    // ==========================================

    stage('Docker Image Build') {
      steps {
        sh '''
          set -eu

          docker build \
            -t "$BACKEND_IMAGE:$BUILD_NUMBER" \
            backend

          docker build \
            -t "$FRONTEND_IMAGE:$BUILD_NUMBER" \
            frontend

          echo "Docker images created successfully."

          docker images | grep inventory
        '''
      }
    }

    // ==========================================
    // 9. TRIVY IMAGE SCAN
    // ==========================================

    stage('Trivy: Container Image Scan') {
      steps {
        sh '''
          set -eu

          mkdir -p trivy-reports
          mkdir -p /var/lib/jenkins/trivy-cache

          trivy() {
            docker run --rm \
              -u "$(id -u):$(id -g)" \
              -e HOME=/tmp \
              -e TRIVY_CACHE_DIR=/cache \
              -v /var/lib/jenkins/trivy-cache:/cache \
              -v "$PWD":/w \
              -w /w \
              ghcr.io/aquasecurity/trivy:0.69.3 "$@"
          }

          for img in backend frontend; do

            docker save \
              "inventory-$img:$BUILD_NUMBER" \
              -o "$img.tar"

            trivy image --no-progress \
              --input "$img.tar" \
              --severity HIGH,CRITICAL \
              --format json \
              --output "trivy-reports/$img.json"

            trivy image --no-progress \
              --input "$img.tar" \
              --severity HIGH,CRITICAL

            trivy image --no-progress \
              --input "$img.tar" \
              --format cyclonedx \
              --output "trivy-reports/sbom-$img.cdx.json"

          done

          echo "Trivy scans completed."
        '''
      }

      post {
        always {
          archiveArtifacts(
            artifacts: 'trivy-reports/*',
            allowEmptyArchive: true
          )
        }
      }
    }

    // ==========================================
    // 10. CRITICAL VULNERABILITY GATE
    // ==========================================

    stage('Security Gate: Critical Image Vulnerabilities') {
      steps {
        sh '''
          set -eu

          for img in backend frontend; do

            docker run --rm \
              -u "$(id -u):$(id -g)" \
              -e HOME=/tmp \
              -e TRIVY_CACHE_DIR=/cache \
              -v /var/lib/jenkins/trivy-cache:/cache \
              -v "$PWD":/w \
              -w /w \
              ghcr.io/aquasecurity/trivy:0.69.3 \
              image \
              --no-progress \
              --input "$img.tar" \
              --severity CRITICAL \
              --ignore-unfixed \
              --exit-code 1

          done

          echo "Critical vulnerability gate passed."
        '''
      }
    }

    // ==========================================
    // 11. TRIVY CONFIGURATION SCAN
    // ==========================================

    stage('Trivy: Kubernetes and Dockerfile Config') {
      steps {
        sh '''
          set -eu

          docker run --rm \
            -u "$(id -u):$(id -g)" \
            -e HOME=/tmp \
            -e TRIVY_CACHE_DIR=/cache \
            -v /var/lib/jenkins/trivy-cache:/cache \
            -v "$PWD":/w \
            -w /w \
            ghcr.io/aquasecurity/trivy:0.69.3 \
            config \
            --severity HIGH,CRITICAL \
            --skip-dirs frontend/node_modules \
            --skip-dirs backend/target \
            --skip-dirs devsecops/terraform .
        '''
      }
    }

    // ==========================================
    // 12. TERRAFORM VALIDATION
    // ==========================================

    stage('Terraform: Validate') {
      steps {
        sh '''
          set -eu

          test -d "$TERRAFORM_DIR"

          docker run --rm \
            -u "$(id -u):$(id -g)" \
            -e HOME=/tmp \
            -v "$PWD/$TERRAFORM_DIR":/tf \
            -w /tf \
            hashicorp/terraform:1.12.2 \
            fmt -check -diff

          docker run --rm \
            -u "$(id -u):$(id -g)" \
            -e HOME=/tmp \
            -v "$PWD/$TERRAFORM_DIR":/tf \
            -w /tf \
            hashicorp/terraform:1.12.2 \
            init -backend=false -input=false

          docker run --rm \
            -u "$(id -u):$(id -g)" \
            -e HOME=/tmp \
            -v "$PWD/$TERRAFORM_DIR":/tf \
            -w /tf \
            hashicorp/terraform:1.12.2 \
            validate

          echo "Terraform validation completed."
        '''
      }
    }

    // ==========================================
    // 13. CHECKOV
    // ==========================================

    stage('Checkov: IaC Security Scan') {
      steps {
        sh '''
          set -eu

          docker run --rm \
            -v "$PWD/$TERRAFORM_DIR":/tf \
            bridgecrew/checkov:latest \
            -d /tf \
            --framework terraform \
            --compact \
            --skip-download \
            --soft-fail
        '''
      }
    }

    // ==========================================
    // 14. INFRASTRUCTURE SECURITY GATE
    // ==========================================

    stage('Infrastructure Gate') {
      steps {
        sh '''
          set -eu

          docker run --rm \
            -v "$PWD/$TERRAFORM_DIR":/tf \
            bridgecrew/checkov:latest \
            -d /tf \
            --framework terraform \
            --compact \
            --quiet \
            --skip-download
        '''
      }
    }

    // ==========================================
    // 15. K3S CLUSTER VERIFICATION
    // ==========================================

    stage('K3s: Verify Cluster') {
      when {
        expression {
          return params.DEPLOY || params.MONITOR
        }
      }

      steps {
        sh '''
          set -eu

          test -f "$K3S_CONFIG"

          cp "$K3S_CONFIG" "$WORKSPACE/.kubeconfig"
          chmod 600 "$WORKSPACE/.kubeconfig"

          export KUBECONFIG="$WORKSPACE/.kubeconfig"

          kubectl get nodes -o wide
          kubectl get namespaces

          echo "K3s cluster is accessible."
        '''
      }
    }

    // ==========================================
    // 16. IMPORT IMAGES INTO K3S
    // ==========================================

    stage('K3s: Import Local Docker Images') {
      when {
        expression {
          return params.DEPLOY
        }
      }

      steps {
        sh '''
          set -eu

          echo "Saving backend image..."

          docker save \
            "$BACKEND_IMAGE:$BUILD_NUMBER" \
            -o backend-image.tar

          echo "Saving frontend image..."

          docker save \
            "$FRONTEND_IMAGE:$BUILD_NUMBER" \
            -o frontend-image.tar

          echo "Importing backend image into K3s..."

          sudo -n /usr/local/bin/k3s ctr images import backend-image.tar

          echo "Importing frontend image into K3s..."

          sudo -n /usr/local/bin/k3s ctr images import frontend-image.tar

          echo "Verifying backend image..."

          sudo -n /usr/local/bin/k3s ctr images list | grep inventory-backend

          echo "Verifying frontend image..."

          sudo -n /usr/local/bin/k3s ctr images list | grep inventory-frontend

          echo "Both images imported into K3s successfully."
        '''
      }
    }

    // ==========================================
    // 17. KUBERNETES DEPLOYMENT
    // ==========================================

    stage('Kubernetes: Deploy Inventory') {
      when {
        expression {
          return params.DEPLOY
        }
      }

      steps {
        sh '''
          set -eu

          export KUBECONFIG="$WORKSPACE/.kubeconfig"

          echo "Applying Kubernetes namespace..."

          kubectl apply -f k8s/namespace.yaml

          echo "Checking database Secret..."

          kubectl -n "$K3S_NAMESPACE" get secret db-credentials >/dev/null || {
            echo "ERROR: db-credentials Secret is missing."
            echo "Create the database Secret before deployment."
            exit 1
          }

          echo "Rendering Kubernetes manifests..."

          sed \
            -e "s|__BACKEND_IMAGE__|$BACKEND_IMAGE:$BUILD_NUMBER|g" \
            -e "s|__FRONTEND_IMAGE__|$FRONTEND_IMAGE:$BUILD_NUMBER|g" \
            k8s/inventory.yaml > rendered.yaml

          echo "Applying Kubernetes resources..."

          kubectl apply -f rendered.yaml

          echo "Waiting for PostgreSQL deployment..."

          kubectl -n "$K3S_NAMESPACE" \
            rollout status deployment/postgres \
            --timeout=180s

          echo "Waiting for backend deployment..."

          kubectl -n "$K3S_NAMESPACE" \
            rollout status deployment/backend \
            --timeout=420s

          echo "Waiting for frontend deployment..."

          kubectl -n "$K3S_NAMESPACE" \
            rollout status deployment/frontend \
            --timeout=180s

          echo "Inventory application deployed."
        '''
      }
    }

    // ==========================================
    // 18. HEALTH CHECKS
    // ==========================================

    stage('Kubernetes: Health Checks and Smoke Tests') {
      when {
        expression {
          return params.DEPLOY
        }
      }

      steps {
        sh '''
          set -eu

          export KUBECONFIG="$WORKSPACE/.kubeconfig"

          echo "Checking Kubernetes pods..."

          kubectl -n "$K3S_NAMESPACE" get pods -o wide
          kubectl -n "$K3S_NAMESPACE" get services

          NODEPORT="$(
            kubectl -n "$K3S_NAMESPACE" \
            get svc frontend \
            -o jsonpath='{.spec.ports[0].nodePort}'
          )"

          test -n "$NODEPORT"

          APP_URL="http://127.0.0.1:$NODEPORT"

          echo "$APP_URL" > app_url.txt

          code=000

          for i in $(seq 1 30); do

            code="$(
              curl -s -o /dev/null \
              -w "%{http_code}" \
              "$APP_URL/api/products" || true
            )"

            echo "Attempt $i: API returned $code"

            [ "$code" = "200" ] && break

            sleep 10
          done

          [ "$code" = "200" ] || {
            echo "API smoke test failed."
            exit 1
          }

          curl -sf -o /dev/null "$APP_URL/" || {
            echo "Frontend smoke test failed."
            exit 1
          }

          echo "Smoke tests passed."
        '''
      }
    }

    // ==========================================
    // 19. OWASP ZAP
    // ==========================================

    stage('OWASP ZAP: DAST') {
      when {
        expression {
          return params.RUN_ZAP && params.DEPLOY
        }
      }

      options {
        timeout(time: 20, unit: 'MINUTES')
      }

      steps {
        sh '''
          set -eu

          echo "Checking application URL..."

          test -s app_url.txt
          APP_URL=$(cat app_url.txt)

          echo "ZAP target: $APP_URL"

          echo "Testing application connectivity from Jenkins host..."

          curl --fail --silent --show-error \
            "$APP_URL/api/products" \
            -o /dev/null

          mkdir -p zap
          chmod 777 zap

          echo "Starting ZAP using host networking..."

          docker run --rm \
            --network host \
            -v "$WORKSPACE/zap:/zap/wrk:rw" \
            ghcr.io/zaproxy/zaproxy:stable \
            zap-baseline.py \
            -t "$APP_URL" \
            -r /zap/wrk/zap-report.html \
            -J /zap/wrk/zap-report.json \
            -I

          echo "Checking ZAP reports..."

          test -s zap/zap-report.html
          test -s zap/zap-report.json

          echo "ZAP scan completed successfully."
        '''
      }

      post {
        always {
          archiveArtifacts(
            artifacts: 'zap/*',
            allowEmptyArchive: true
          )
        }
      }
    }

    // 20. PROMETHEUS AND GRAFANA
    // ==========================================

    stage('Monitoring: Prometheus and Grafana on K3s') {
      when {
        expression {
          return params.MONITOR
        }
      }

      options {
        timeout(time: 30, unit: 'MINUTES')
      }

      steps {
        sh '''
          set -eu

          export KUBECONFIG="$WORKSPACE/.kubeconfig"

          kubectl create namespace "$MONITORING_NAMESPACE" \
            --dry-run=client -o yaml | kubectl apply -f -

          kubectl -n "$MONITORING_NAMESPACE" \
            get secret grafana-admin >/dev/null 2>&1 || \
            kubectl -n "$MONITORING_NAMESPACE" \
            create secret generic grafana-admin \
            --from-literal=admin-user=admin \
            --from-literal=admin-password="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"

          helm repo add prometheus-community \
            https://prometheus-community.github.io/helm-charts

          helm repo update

          helm upgrade --install monitoring \
            prometheus-community/kube-prometheus-stack \
            --version 92.17.1 \
            --namespace "$MONITORING_NAMESPACE" \
            -f "$MONITORING_DIR/k8s-monitoring-values.yaml" \
            --set grafana.service.type=NodePort \
            --set grafana.service.nodePort=30300 \
            --set grafana.admin.existingSecret=grafana-admin \
            --wait \
            --timeout 20m

          if [ -f "$MONITORING_DIR/servicemonitor.yaml" ]; then
            kubectl apply -f "$MONITORING_DIR/servicemonitor.yaml"
          fi

          if [ -f "$MONITORING_DIR/prometheusrule.yaml" ]; then
            kubectl apply -f "$MONITORING_DIR/prometheusrule.yaml"
          fi

          if [ -f "$MONITORING_DIR/grafana-dashboard.yaml" ]; then
            kubectl apply -f "$MONITORING_DIR/grafana-dashboard.yaml"
          fi

          kubectl -n "$MONITORING_NAMESPACE" get pods
          kubectl -n "$MONITORING_NAMESPACE" get svc

          echo "Grafana URL: http://<SERVER-PUBLIC-IP>:30300"
          echo "Grafana username: admin"

          echo "Retrieve the Grafana password with:"
          echo "sudo k3s kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d"
        '''
      }
    }
  }

  // ==========================================
  // POST ACTIONS
  // ==========================================

  post {
    always {
      sh '''
        rm -f \
          "$WORKSPACE/.kubeconfig" \
          rendered.yaml \
          backend-image.tar \
          frontend-image.tar \
          backend.tar \
          frontend.tar \
          tfplan || true
      '''
    }

    success {
      echo 'DevSecOps pipeline completed successfully.'
    }

    failure {
      echo 'Pipeline failed. Check the first failed stage in the console output.'
    }
  }
}
