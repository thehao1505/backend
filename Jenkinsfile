pipeline {
  agent any

  environment {
    DOCKER_IMAGE = "thehao155/backend"
    DOCKER_TAG   = "latest"
  }

  stages {
    // stage('Checkout') {
    //   steps {
    //     git branch: 'main', url: 'git@github.com:thehao1505/backend.git'
    //   }
    // }

    stage('Prepare .env') {
      steps {
        withCredentials([file(credentialsId: 'secretfile', variable: 'ENV_FILE')]) {
          // Copy secretfile thành .env trong workspace
          sh 'cp $ENV_FILE .env'
        }
      }
    }

    stage('Deploy with docker-compose') {
      steps {
        sh '''
        docker-compose down
        docker-compose up -d --build
        '''
      }
    }
  }

  post {
    always {
      echo 'Pipeline finished'
    }
  }
}
