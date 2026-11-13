
pipeline {
  agent any

  parameters {
    booleanParam(
      name: 'DEPLOY',
      defaultValue: false,
      description: 'Build, import images into local K3s and deploy Inventory Management'
    )
    booleanParam(
      name: 'MONITOR',
      defaultValue: false,
      description: 'Install or upgrade Prometheus and Grafana on K3s'
    )
    booleanParam(
      name: 'RUN_ZAP',
      defaultValue: false,
      description: 'Run OWASP ZAP baseline scan against the deployed application'
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
    SUPPRESSION_FILE = 'devsecops/security/dependency-check-suppressions.xml'
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

          echo "Checking required tools..."

          command -v docker
          command -v curl
          command -v kubectl

          docker info >/dev/null

          if [ "${DEPLOY}" = "true" ] || [ "${MONITOR}" = "true" ]; then
            test -f "$K3S_CONFIG" || {
              echo "K3s kubeconfig missing: $K3S_CONFIG"
              exit 1
            }

            /usr/local/bin/k3s kubectl get nodes
          fi

          if [ "${MONITOR}" = "true" ]; then
            command -v helm
          fi

          echo "Preflight checks completed."
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
            --config /repo/.gitleaks.toml \
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
    // 4. FRONTEND BUILD
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
        timeout(time: 45, unit: 'MINUTES')
      }

      steps {
        sh '''
          set -eu

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
            --suppression "/src/$SUPPRESSION_FILE" \
            --data /odc-data \
            --out /src/odc-reports \
            --format HTML \
            --format JSON \
            --disableNodeAudit \
            --nvdMaxRetryCount 20
        '''

        archiveArtifacts(
          artifacts: 'odc-reports/*',
          allowEmptyArchive: true
        )
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

            echo "Linting $file"

            docker run --rm -i \
              hadolint/hadolint:latest-debian < "$file"
          done
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

          docker images | grep inventory
        '''
      }
    }

    // ==========================================
    // 9. TRIVY IMAGE SCAN AND SBOM
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

            trivy image \
              --no-progress \
              --input "$img.tar" \
              --severity HIGH,CRITICAL \
              --format json \
              --output "trivy-reports/$img.json"

            trivy image \
              --no-progress \
              --input "$img.tar" \
              --severity HIGH,CRITICAL

            trivy image \
              --no-progress \
              --input "$img.tar" \
              --format cyclonedx \
              --output "trivy-reports/sbom-$img.cdx.json"

          done
        '''

        archiveArtifacts(
          artifacts: 'trivy-reports/*',
          allowEmptyArchive: true
        )
      }
    }

    // ==========================================
    // 10. CRITICAL VULNERABILITY GATE
    // ==========================================

    stage('Security Gate: Critical Image Vulnerabilities') {
      steps {
        sh '''
          set -eu

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

            echo "Checking critical vulnerabilities in $img..."

            trivy image \
              --no-progress \
              --input "$img.tar" \
              --severity CRITICAL \
              --ignore-unfixed \
              --exit-code 1

          done
        '''
      }
    }

    // ==========================================
    // 11. TRIVY CONFIG SCAN
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

          rm -rf "$TERRAFORM_DIR/.terraform"

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

          rm -rf "$TERRAFORM_DIR/.terraform"
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
    // 14. INFRASTRUCTURE GATE
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

          echo "Creating Jenkins workspace kubeconfig..."

          cat "$K3S_CONFIG" > "$WORKSPACE/.kubeconfig"
          chmod 600 "$WORKSPACE/.kubeconfig"

          export KUBECONFIG="$WORKSPACE/.kubeconfig"

          echo "Checking K3s nodes..."

          kubectl get nodes -o wide

          echo "Checking Kubernetes namespaces..."

          kubectl get namespaces
        '''
      }
    }

    // ==========================================
    // 16. IMPORT DOCKER IMAGES INTO K3S
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

          docker save \
            "$BACKEND_IMAGE:$BUILD_NUMBER" \
            -o backend-image.tar

          docker save \
            "$FRONTEND_IMAGE:$BUILD_NUMBER" \
            -o frontend-image.tar

          echo "Importing backend image into K3s..."

          sudo -n /usr/local/bin/k3s ctr images import backend-image.tar

          echo "Importing frontend image into K3s..."

          sudo -n /usr/local/bin/k3s ctr images import frontend-image.tar

          echo "Verifying imported images..."

          sudo -n /usr/local/bin/k3s ctr images list | grep inventory-backend

          sudo -n /usr/local/bin/k3s ctr images list | grep inventory-frontend
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

          echo "Checking database credentials secret..."

          kubectl -n "$K3S_NAMESPACE" get secret db-credentials >/dev/null 2>&1 || \
            kubectl -n "$K3S_NAMESPACE" create secret generic db-credentials \
              --from-literal=password="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"

          echo "Rendering Kubernetes manifest..."

          sed \
            -e "s|__BACKEND_IMAGE__|$BACKEND_IMAGE:$BUILD_NUMBER|g" \
            -e "s|__FRONTEND_IMAGE__|$FRONTEND_IMAGE:$BUILD_NUMBER|g" \
            k8s/inventory.yaml > rendered.yaml

          echo "Applying Inventory Management deployment..."

          kubectl apply -f rendered.yaml

          echo "Waiting for PostgreSQL deployment..."

          kubectl -n "$K3S_NAMESPACE" rollout status \
            deployment/postgres --timeout=180s

          echo "Waiting for backend deployment..."

          kubectl -n "$K3S_NAMESPACE" rollout status \
            deployment/backend --timeout=420s

          echo "Waiting for frontend deployment..."

          kubectl -n "$K3S_NAMESPACE" rollout status \
            deployment/frontend --timeout=180s

          echo "Kubernetes deployment completed."
        '''
      }
    }

    // ==========================================
    // 18. HEALTH CHECKS AND SMOKE TESTS
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

          echo "Checking application pods..."

          kubectl -n "$K3S_NAMESPACE" get pods -o wide

          echo "Checking application services..."

          kubectl -n "$K3S_NAMESPACE" get services

          NODEPORT="$(kubectl -n "$K3S_NAMESPACE" get svc frontend -o jsonpath='{.spec.ports[0].nodePort}')"

          [ -n "$NODEPORT" ] || {
            echo "Frontend Service must be type NodePort for this pipeline."
            exit 1
          }

          APP_URL="http://127.0.0.1:$NODEPORT"

          echo "$APP_URL" > "$WORKSPACE/app_url.txt"

          echo "Application URL: $APP_URL"

          code=000

          for i in $(seq 1 30); do

            code="$(curl -s -o /dev/null -w "%{http_code}" \
              "$APP_URL/api/products" || true)"

            echo "Attempt $i: /api/products -> $code"

            [ "$code" = "200" ] && break

            sleep 10
          done

          [ "$code" = "200" ] || {
            echo "API smoke test failed."
            exit 1
          }

          echo "Checking frontend..."

          curl -sf -o /dev/null "$APP_URL/" || {
            echo "Frontend smoke test failed."
            exit 1
          }

          echo "API and frontend smoke tests passed."
        '''
      }
    }

    // ==========================================
    // 19. OWASP ZAP DAST
    // ==========================================

    stage('OWASP ZAP: DAST') {
      when {
        expression {
          return params.RUN_ZAP && params.DEPLOY
        }
      }

      options {
        timeout(time: 15, unit: 'MINUTES')
      }

      steps {
        sh '''
          set -e

          echo "Preparing ZAP report directory..."

          mkdir -p "$WORKSPACE/zap"

          rm -f "$WORKSPACE/zap/zap-report.html"
          rm -f "$WORKSPACE/zap/zap-report.json"

          test -s "$WORKSPACE/app_url.txt"

          APP_URL="$(cat "$WORKSPACE/app_url.txt")"

          echo "ZAP target: $APP_URL"

          echo "Checking application connectivity..."

          curl --fail --silent --show-error \
            "$APP_URL/api/products" \
            -o /dev/null

          echo "Running OWASP ZAP baseline scan..."

          docker run --rm \
            --network host \
            -v "$WORKSPACE/zap:/zap/wrk:rw" \
            -w /zap/wrk \
            ghcr.io/zaproxy/zaproxy:stable \
            zap-baseline.py \
            -t "$APP_URL" \
            -r zap-report.html \
            -J zap-report.json \
            -I

          echo "Checking generated ZAP reports..."

          ls -lah "$WORKSPACE/zap"

          test -s "$WORKSPACE/zap/zap-report.html"
          test -s "$WORKSPACE/zap/zap-report.json"

          echo "ZAP reports generated successfully."
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

    // ==========================================
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

          echo "Creating monitoring namespace..."

          kubectl create namespace "$MONITORING_NAMESPACE" \
            --dry-run=client -o yaml | kubectl apply -f -

          echo "Creating Grafana credentials secret if missing..."

          kubectl -n "$MONITORING_NAMESPACE" get secret grafana-admin >/dev/null 2>&1 || \
            kubectl -n "$MONITORING_NAMESPACE" create secret generic grafana-admin \
              --from-literal=admin-user=admin \
              --from-literal=admin-password="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"

          echo "Adding Prometheus community Helm repository..."

          helm repo add prometheus-community \
            https://prometheus-community.github.io/helm-charts

          helm repo update

          echo "Installing Prometheus and Grafana..."

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

          echo "Applying optional monitoring resources..."

          [ ! -f "$MONITORING_DIR/servicemonitor.yaml" ] || \
            kubectl apply -f "$MONITORING_DIR/servicemonitor.yaml"

          [ ! -f "$MONITORING_DIR/prometheusrule.yaml" ] || \
            kubectl apply -f "$MONITORING_DIR/prometheusrule.yaml"

          [ ! -f "$MONITORING_DIR/grafana-dashboard.yaml" ] || \
            kubectl apply -f "$MONITORING_DIR/grafana-dashboard.yaml"

          echo "Monitoring pods..."

          kubectl -n "$MONITORING_NAMESPACE" get pods

          echo "Monitoring services..."

          kubectl -n "$MONITORING_NAMESPACE" get svc

          echo "Grafana URL: http://<EC2-PUBLIC-IP>:30300"

          echo "Grafana username: admin"

          echo "Retrieve password on EC2 using:"

          echo "sudo /usr/local/bin/k3s kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d"
        '''
      }
    }
  }

  // ==========================================
  // PIPELINE POST ACTIONS
  // ==========================================

  post {
    always {
      sh '''
        rm -f "$WORKSPACE/.kubeconfig" \
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
      echo 'Pipeline failed. Review the failed stage and Jenkins console output.'
    }
  }
}
