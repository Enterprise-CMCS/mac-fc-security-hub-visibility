FROM openjdk:11

RUN echo "deb https://packages.atlassian.com/debian/atlassian-sdk-deb/ stable contrib" >>/etc/apt/sources.list \
    && wget https://packages.atlassian.com/api/gpg/key/public  \
    && apt-key add public \
    && apt-get update \
    && apt-get install --yes atlassian-plugin-sdk \
    && apt-get install --yes jq \
    && mkdir /opt/atlas \
    && cd /opt/atlas

COPY config_jira.sh /config_jira.sh
RUN chmod +x /config_jira.sh
COPY start_jira.sh /start_jira.sh
RUN chmod +x /start_jira.sh

CMD ["/start_jira.sh"]
