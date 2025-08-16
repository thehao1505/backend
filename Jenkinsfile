pipeline {
    agent any

    environment {
        DOCKER_IMAGE = "thehao155/backend"
        DOCKER_TAG   = "latest"
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: 'main', url: 'git@github.com:thehao155/backend.git', credentialsId: 'b3ae43c1-db4e-4f06-b8ee-046391a8aa9b'
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    sh 'docker build -t $DOCKER_IMAGE:$DOCKER_TAG .'
                }
            }
        }

        stage('Run Container') {
            steps {
                withCredentials([file(credentialsId: 'nestjs-env', variable: 'ENV_FILE')]) {
                    script {
                        sh 'docker stop backend || true && docker rm backend || true'

                        sh '''
                        docker run -d --name backend \
                            --env-file $ENV_FILE \
                            -p 3000:3000 \
                            $DOCKER_IMAGE:$DOCKER_TAG
                        '''
                    }
                }
            }
        }
    }
}
