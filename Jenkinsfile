pipeline {
  agent any
  parameters {
    booleanParam(name: 'PROVISION', defaultValue: false, description: 'Create ECR + EKS on AWS (costs roughly $0.15-0.20/hour, check AWS pricing)')
    booleanParam(name: 'DESTROY', defaultValue: false, description: 'Delete everything Terraform created on AWS')
    booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Push images to ECR and deploy Inventory to EKS')
    booleanParam(name: 'MONITOR', defaultValue: false, description: 'Install Prometheus and Grafana on EKS')
    string(name: 'GRAFANA_CIDR', defaultValue: '', description: 'Who may open Grafana, e.g. 203.0.113.10/32. Empty = this Jenkins server public IP')
  }
  options { timestamps() }
  environment {
    AWS_DEFAULT_REGION = 'ap-south-1'
    CLUSTER_NAME       = 'inventory-eks'
  }
  stages {
    stage('Gitleaks: Secret Scan') {
      steps {
        // scans the whole git history, not only the working tree
        sh 'docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/repo ghcr.io/gitleaks/gitleaks:v8.24.2 git /repo --config /repo/.gitleaks.toml --redact --verbose'
      }
    }
    stage('Maven: Backend Build and Tests') {
      steps {
        sh 'docker run --rm -u $(id -u):$(id -g) -v "$PWD/backend":/app -w /app maven:3.9-eclipse-temurin-17 mvn -B -Duser.home=/tmp clean verify'
      }
      post { always { junit allowEmptyResults: true, testResults: 'backend/target/surefire-reports/*.xml' } }
    }
    stage('npm: Frontend Tests and Build') {
      steps {
        // CI=true: lint warnings fail the build
        sh 'docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e CI=true -v "$PWD/frontend":/app -w /app node:22 sh -c "npm ci --no-audit --no-fund && npm run test:ci && npm run build"'
      }
    }
    stage('SonarQube: SAST') {
      steps {
        withCredentials([string(credentialsId: 'sonar-token', variable: 'SONAR_TOKEN')]) {
          // project settings (sources, coverage reports) come from sonar-project.properties
          sh '''docker run --rm --network host -u $(id -u):$(id -g) -e SONAR_TOKEN -e SONAR_USER_HOME=/tmp/.sonar -v "$PWD":/usr/src sonarsource/sonar-scanner-cli:11 \
            -Dsonar.host.url=http://localhost:9000 \
            -Dsonar.working.directory=/tmp/scannerwork-run \
            -Dsonar.qualitygate.wait=true'''
        }
      }
    }
    stage('OWASP Dependency-Check: SCA') {
      options { timeout(time: 45, unit: 'MINUTES') }
      steps {
        // nvd-api-key is only used for the first download of the vulnerability database (afterwards --noupdate is used)
        withCredentials([string(credentialsId: 'nvd-api-key', variable: 'NVD_API_KEY')]) {
          sh '''mkdir -p odc-reports /var/lib/jenkins/odc-data
          if [ -f /var/lib/jenkins/odc-data/odc.mv.db ]; then UPDATE="--noupdate"; else UPDATE="--nvdApiKey $NVD_API_KEY"; fi
          docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e JAVA_OPTS=-Xmx2g \
            -v "$PWD":/src -v /var/lib/jenkins/odc-data:/odc-data \
            owasp/dependency-check:12.1.0 \
            --scan "/src/backend/target/*.jar" --scan /src/frontend/package-lock.json \
            --suppression /src/devsecops/dependency-check-suppressions.xml \
            --data /odc-data --out /src/odc-reports --format HTML --format JSON \
            --disableNodeAudit $UPDATE'''
        }
        // report only: the blocking vulnerability gate is Trivy (Security Gate stage)
        archiveArtifacts artifacts: 'odc-reports/*', allowEmptyArchive: true
      }
    }
    stage('Docker Image Build') {
      steps {
        sh '''docker build -t inventory-backend:${BUILD_NUMBER} backend
        docker build -t inventory-frontend:${BUILD_NUMBER} frontend'''
      }
    }
    stage('Trivy: Container Image Scan') {
      steps {
        sh '''mkdir -p trivy-reports /var/lib/jenkins/trivy-cache
        trivy() { docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e TRIVY_CACHE_DIR=/cache \
            -v /var/lib/jenkins/trivy-cache:/cache -v "$PWD":/w -w /w ghcr.io/aquasecurity/trivy:0.69.3 "$@"; }
        for img in backend frontend; do
          docker save inventory-$img:${BUILD_NUMBER} -o $img.tar
          trivy image --no-progress --input $img.tar --severity HIGH,CRITICAL --format json --output trivy-reports/$img.json
          trivy image --no-progress --input $img.tar --severity HIGH,CRITICAL
          trivy image --no-progress --input $img.tar --format cyclonedx --output trivy-reports/sbom-$img.cdx.json
        done'''
        archiveArtifacts artifacts: 'trivy-reports/*', allowEmptyArchive: true
      }
    }
    stage('Security Gate') {
      steps {
        sh '''trivy() { docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e TRIVY_CACHE_DIR=/cache \
            -v /var/lib/jenkins/trivy-cache:/cache -v "$PWD":/w -w /w ghcr.io/aquasecurity/trivy:0.69.3 "$@"; }
        for img in backend frontend; do
          trivy image --no-progress --input $img.tar --severity CRITICAL --ignore-unfixed --exit-code 1
        done'''
      }
    }
    stage('Trivy: Kubernetes and Dockerfile Config (report)') {
      steps {
        // report only: Checkov is the blocking gate for Terraform; this looks at the manifests and Dockerfiles
        sh '''trivy() { docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e TRIVY_CACHE_DIR=/cache \
            -v /var/lib/jenkins/trivy-cache:/cache -v "$PWD":/w -w /w ghcr.io/aquasecurity/trivy:0.69.3 "$@"; }
        trivy config --severity HIGH,CRITICAL --skip-dirs frontend/node_modules --skip-dirs backend/target --skip-dirs terraform .'''
      }
    }
    stage('Terraform: Validate') {
      steps {
        sh '''rm -rf terraform/.terraform
        docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD/terraform":/tf -w /tf hashicorp/terraform:1.12.2 fmt -check -diff || echo "WARNING: formatting differs - run 'terraform fmt' in terraform/"
        docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD/terraform":/tf -w /tf hashicorp/terraform:1.12.2 init -backend=false -input=false
        docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD/terraform":/tf -w /tf hashicorp/terraform:1.12.2 validate
        rm -rf terraform/.terraform'''
      }
    }
    stage('Checkov: IaC Security Scan') {
      steps {
        sh 'docker run --rm -v "$PWD/terraform":/tf bridgecrew/checkov:latest -d /tf --framework terraform --compact --skip-download --soft-fail'
      }
    }
    stage('Infrastructure Gate') {
      steps {
        sh 'docker run --rm -v "$PWD/terraform":/tf bridgecrew/checkov:latest -d /tf --framework terraform --compact --quiet --skip-download'
      }
    }
    stage('Terraform: Plan') {
      when { expression { return params.PROVISION } }
      steps {
        withCredentials([string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'), string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')]) {
          sh '''mkdir -p /var/lib/jenkins/tfstate/plugins
          CIDR="$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')/32"
          echo "EKS API will be limited to $CIDR"
          rm -rf terraform/.terraform
          sh scripts/tf.sh init -input=false -backend-config=path=/state/terraform.tfstate
          sh scripts/tf.sh plan -input=false -var=region=$AWS_DEFAULT_REGION -var=authorized_cidr=$CIDR -out=tfplan'''
        }
      }
    }
    stage('Approval: Provision AWS') {
      when { expression { return params.PROVISION } }
      steps {
        timeout(time: 30, unit: 'MINUTES') {
          input message: 'Create ECR + EKS on AWS now? Review the plan above. It costs money every hour until you destroy it.', ok: 'Apply'
        }
      }
    }
    stage('Terraform: Apply') {
      when { expression { return params.PROVISION } }
      steps {
        withCredentials([string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'), string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')]) {
          sh '''sh scripts/tf.sh apply -input=false tfplan
          sh scripts/tf.sh output'''
        }
      }
    }
    stage('Terraform: Destroy') {
      when { expression { return params.DESTROY } }
      steps {
        timeout(time: 30, unit: 'MINUTES') {
          input message: 'DELETE the AWS resources created by Terraform (cluster, registry, network)?', ok: 'Destroy'
        }
        withCredentials([string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'), string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')]) {
          // the load balancers created by the Services must go first, otherwise the VPC cannot be deleted
          sh '''export KUBECONFIG="$WORKSPACE/.kubeconfig"
          aws eks update-kubeconfig --name $CLUSTER_NAME && {
            helm uninstall monitoring -n monitoring || true
            kubectl delete namespace inventory monitoring --timeout=300s || true
          } || true
          CIDR="$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')/32"
          rm -rf terraform/.terraform
          sh scripts/tf.sh init -input=false -backend-config=path=/state/terraform.tfstate
          sh scripts/tf.sh destroy -input=false -auto-approve -var=region=$AWS_DEFAULT_REGION -var=authorized_cidr=$CIDR'''
        }
      }
    }
    stage('ECR: Push Images') {
      when { expression { return params.DEPLOY } }
      steps {
        withCredentials([string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'), string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')]) {
          // only reached when every scan above passed
          sh '''export DOCKER_CONFIG="$WORKSPACE/.docker"
          ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
          REGISTRY=$ACCOUNT.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
          aws ecr get-login-password | docker login --username AWS --password-stdin $REGISTRY
          for img in backend frontend; do
            docker tag inventory-$img:${BUILD_NUMBER} $REGISTRY/inventory-$img:${BUILD_NUMBER}
            docker push $REGISTRY/inventory-$img:${BUILD_NUMBER}
          done
          docker logout $REGISTRY
          rm -rf "$DOCKER_CONFIG"'''
        }
      }
    }
    stage('EKS: Deploy') {
      when { expression { return params.DEPLOY } }
      steps {
        withCredentials([string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'), string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')]) {
          sh '''export KUBECONFIG="$WORKSPACE/.kubeconfig"
          ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
          REGISTRY=$ACCOUNT.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
          aws eks update-kubeconfig --name $CLUSTER_NAME
          kubectl apply -f k8s/namespace.yaml
          # database password: generated once, kept only in the cluster
          kubectl -n inventory get secret db-credentials >/dev/null 2>&1 || kubectl -n inventory create secret generic db-credentials --from-literal=password="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
          sed -e "s|__BACKEND_IMAGE__|$REGISTRY/inventory-backend:${BUILD_NUMBER}|" -e "s|__FRONTEND_IMAGE__|$REGISTRY/inventory-frontend:${BUILD_NUMBER}|" k8s/inventory.yaml > rendered.yaml
          kubectl apply -f rendered.yaml
          kubectl -n inventory rollout status deployment/postgres --timeout=180s
          kubectl -n inventory rollout status deployment/backend --timeout=420s && kubectl -n inventory rollout status deployment/frontend --timeout=180s || {
            echo "Rollout failed - rolling back"
            kubectl -n inventory rollout undo deployment/backend || true
            kubectl -n inventory rollout undo deployment/frontend || true
            exit 1
          }'''
        }
      }
    }
    stage('Health Checks and Smoke Tests') {
      when { expression { return params.DEPLOY } }
      steps {
        withCredentials([string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'), string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')]) {
          sh '''export KUBECONFIG="$WORKSPACE/.kubeconfig"
          aws eks update-kubeconfig --name $CLUSTER_NAME
          kubectl -n inventory get pods
          LB=""
          for i in $(seq 1 40); do
            LB=$(kubectl -n inventory get svc frontend -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
            [ -n "$LB" ] && break
            echo "waiting for the load balancer..."; sleep 15
          done
          [ -n "$LB" ] || { echo "No load balancer address"; exit 1; }
          echo "App URL: http://$LB"
          echo "http://$LB" > app_url.txt
          code=000
          for i in $(seq 1 30); do
            code=$(curl -s -o /dev/null -w "%{http_code}" http://$LB/api/products || true)
            echo "attempt $i: /api/products -> $code"
            [ "$code" = "200" ] && break
            sleep 15
          done
          [ "$code" = "200" ] || { echo "Smoke test failed: API did not answer 200"; exit 1; }
          curl -sf -o /dev/null http://$LB/ || { echo "Smoke test failed: frontend page"; exit 1; }
          # nginx answers unknown paths with index.html (HTTP 200), so check the BODY: metrics must not be public
          if curl -s http://$LB/actuator/prometheus | grep -q '^# HELP'; then echo "FAIL: actuator metrics are exposed"; exit 1; fi
          echo "Smoke tests passed"'''
        }
      }
    }
    stage('OWASP ZAP: DAST') {
      when { expression { return params.DEPLOY } }
      options { timeout(time: 20, unit: 'MINUTES') }
      steps {
        // passive baseline scan of the live site; findings are reported, -I stops warnings from failing the build
        sh '''mkdir -p zap && chmod 777 zap
        docker run --rm -v "$PWD/zap:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t "$(cat app_url.txt)" -r zap-report.html -J zap-report.json -I'''
        archiveArtifacts artifacts: 'zap/*', allowEmptyArchive: true
      }
    }
    stage('Monitoring: Prometheus and Grafana') {
      when { expression { return params.MONITOR || params.DEPLOY } }
      options { timeout(time: 25, unit: 'MINUTES') }
      steps {
        withCredentials([string(credentialsId: 'aws-access-key-id', variable: 'AWS_ACCESS_KEY_ID'), string(credentialsId: 'aws-secret-access-key', variable: 'AWS_SECRET_ACCESS_KEY')]) {
          sh '''export KUBECONFIG="$WORKSPACE/.kubeconfig"
          aws eks update-kubeconfig --name $CLUSTER_NAME
          kubectl apply -f k8s/namespace.yaml
          kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
          kubectl -n monitoring get secret grafana-admin >/dev/null 2>&1 || kubectl -n monitoring create secret generic grafana-admin --from-literal=admin-user=admin --from-literal=admin-password="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
          # Grafana gets a public load balancer, so lock it to one address
          if [ -n "$GRAFANA_CIDR" ]; then GCIDR="$GRAFANA_CIDR"; else GCIDR="$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')/32"; fi
          echo "Grafana will be reachable from $GCIDR only"
          helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
          helm repo update
          helm upgrade --install monitoring prometheus-community/kube-prometheus-stack --version 92.17.1 --namespace monitoring -f k8s/monitoring-values.yaml --set "grafana.service.loadBalancerSourceRanges[0]=$GCIDR" --wait --timeout 15m
          # scrape config, alerts and dashboard for this application
          kubectl apply -f monitoring/servicemonitor.yaml -f monitoring/prometheusrule.yaml -f monitoring/grafana-dashboard.yaml
          kubectl -n monitoring get pods
          LB=""
          for i in $(seq 1 40); do
            LB=$(kubectl -n monitoring get svc monitoring-grafana -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
            [ -n "$LB" ] && break
            echo "waiting for the Grafana load balancer..."; sleep 15
          done
          [ -n "$LB" ] || { echo "No Grafana load balancer address"; exit 1; }
          echo "Grafana URL: http://$LB   (user: admin)"
          echo "Password:  kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d"
          code=000
          for i in $(seq 1 30); do
            code=$(curl -s -o /dev/null -w "%{http_code}" http://$LB/login || true)
            echo "attempt $i: /login -> $code"
            [ "$code" = "200" ] && break
            sleep 15
          done
          [ "$code" = "200" ] || { echo "Grafana did not answer 200"; exit 1; }
          echo "Monitoring is up"'''
        }
      }
    }
  }
  post {
    always {
      sh 'rm -rf .kubeconfig .docker rendered.yaml tfplan terraform/tfplan terraform/.terraform backend.tar frontend.tar || true'
    }
  }
}
