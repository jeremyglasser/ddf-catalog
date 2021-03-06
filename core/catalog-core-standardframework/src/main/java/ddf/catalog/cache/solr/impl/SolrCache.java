/**
 * Copyright (c) Codice Foundation
 * 
 * This is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or any later version.
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details. A copy of the GNU Lesser General Public License
 * is distributed along with this program and can be found at
 * <http://www.gnu.org/licenses/lgpl.html>.
 * 
 **/
package ddf.catalog.cache.solr.impl;

import com.google.common.collect.Lists;
import com.spatial4j.core.distance.DistanceUtils;
import ddf.catalog.data.AttributeType.AttributeFormat;
import ddf.catalog.data.Metacard;
import ddf.catalog.data.MetacardCreationException;
import ddf.catalog.data.MetacardType;
import ddf.catalog.data.Result;
import ddf.catalog.data.impl.MetacardImpl;
import ddf.catalog.data.impl.ResultImpl;
import ddf.catalog.filter.FilterAdapter;
import ddf.catalog.operation.DeleteRequest;
import ddf.catalog.operation.QueryRequest;
import ddf.catalog.operation.SourceResponse;
import ddf.catalog.operation.impl.QueryResponseImpl;
import ddf.catalog.operation.impl.SourceResponseImpl;
import ddf.catalog.source.IngestException;
import ddf.catalog.source.UnsupportedQueryException;
import ddf.measure.Distance;
import ddf.measure.Distance.LinearUnit;
import ddf.security.encryption.EncryptionService;
import org.apache.commons.lang.StringUtils;
import org.apache.http.conn.ssl.SSLConnectionSocketFactory;
import org.apache.http.conn.ssl.SSLContexts;
import org.apache.http.impl.client.BasicCookieStore;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.solr.client.solrj.SolrQuery;
import org.apache.solr.client.solrj.SolrQuery.ORDER;
import org.apache.solr.client.solrj.SolrRequest.METHOD;
import org.apache.solr.client.solrj.SolrServer;
import org.apache.solr.client.solrj.SolrServerException;
import org.apache.solr.client.solrj.request.AbstractUpdateRequest.ACTION;
import org.apache.solr.client.solrj.response.QueryResponse;
import org.apache.solr.common.SolrDocument;
import org.apache.solr.common.SolrDocumentList;
import org.apache.solr.common.SolrException;
import org.apache.solr.common.SolrInputDocument;
import org.codice.ddf.configuration.ConfigurationManager;
import org.codice.ddf.configuration.ConfigurationWatcher;
import org.opengis.filter.sort.SortBy;
import org.opengis.filter.sort.SortOrder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.net.ssl.SSLContext;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.Serializable;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.UnrecoverableKeyException;
import java.security.cert.CertificateException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Catalog cache implementation using Apache Solr 4
 * 
 */
public class SolrCache implements ConfigurationWatcher {

    private static final String COULD_NOT_COMPLETE_DELETE_REQUEST_MESSAGE = "Could not complete delete request.";

    private static final String RELEVANCE_SORT_FIELD = "score";

    private static final String QUOTE = "\"";

    private static final String REQUEST_MUST_NOT_BE_NULL_MESSAGE = "Request must not be null";

    private static final Logger LOGGER = LoggerFactory.getLogger(SolrCache.class);

    public static final String METACARD_CACHE_CORE_NAME = "metacard_cache";

    private static final long DEFAULT_CACHE_EXPIRATION_INTERVAL_IN_MINUTES = TimeUnit.DAYS.toMinutes(7);

    private FilterAdapter filterAdapter;

    private DynamicSchemaResolver resolver;

    private String url = SolrServerFactory.DEFAULT_HTTPS_ADDRESS;

    private SolrServer server;

    private SolrFilterDelegateFactory solrFilterDelegateFactory;

    private AtomicBoolean dirty = new AtomicBoolean(false);

    private ScheduledExecutorService scheduler;

    private long expirationIntervalInMinutes;

    private String keystoreLoc, keystorePass;

    private String truststoreLoc, truststorePass;

    private EncryptionService encryptService;

    /**
     * Convenience constructor that creates a the Solr server
     *
     * @param adapter
     *            injected implementation of FilterAdapter
     */
    public SolrCache(FilterAdapter adapter, SolrFilterDelegateFactory solrFilterDelegateFactory) {
        if (System.getProperty("host") != null && System.getProperty("jetty.port") != null && System
                .getProperty("hostContext") != null) {
            url = "http://" + System.getProperty("host") + ":" + System.getProperty("jetty.port") +
                    "/" + StringUtils.stripStart(System.getProperty("hostContext"), "/");
        }
        this.updateServer(url);
        this.filterAdapter = adapter;
        this.solrFilterDelegateFactory = solrFilterDelegateFactory;
        this.resolver = new DynamicSchemaResolver();
        this.expirationIntervalInMinutes = DEFAULT_CACHE_EXPIRATION_INTERVAL_IN_MINUTES;
        configureCacheExpirationScheduler();
    }

    public SourceResponse query(QueryRequest request) throws UnsupportedQueryException {

        if (request == null || request.getQuery() == null) {
            return new QueryResponseImpl(request, new ArrayList<Result>(), true, 0L);
        }

        long totalHits = 0L;

        List<Result> results = new ArrayList<Result>();

        SolrFilterDelegate solrFilterDelegate = solrFilterDelegateFactory.newInstance(resolver);

        solrFilterDelegate.setSortPolicy(request.getQuery().getSortBy());

        SolrQuery query = filterAdapter.adapt(request.getQuery(), solrFilterDelegate);

        // Solr does not support outside parenthesis in certain queries and throws EOF exception.
        String queryPhrase = query.getQuery().trim();
        if (queryPhrase.matches("\\(\\s*\\{!.*\\)")) {
            query.setQuery(queryPhrase.replaceAll("^\\(\\s*|\\s*\\)$", ""));
        }

        if (LOGGER.isDebugEnabled()) {
            LOGGER.debug("Prepared Query: {}", query.getQuery());
            if (query.getFilterQueries() != null && query.getFilterQueries().length > 0) {
                LOGGER.debug("Filter Queries: {}", Arrays.toString(query.getFilterQueries()));
            }
        }

        if (request.getQuery().getPageSize() < 1) {
            query.setRows(Integer.MAX_VALUE);
        } else {
            query.setRows(request.getQuery().getPageSize());
        }

        /* Sorting */
        SortBy sortBy = request.getQuery().getSortBy();

        String sortProperty = "";

        if (sortBy != null && sortBy.getPropertyName() != null) {

            sortProperty = sortBy.getPropertyName().getPropertyName();

            ORDER order = ORDER.desc;

            if (sortBy.getSortOrder() == SortOrder.ASCENDING) {
                order = ORDER.asc;
            }

            if (Result.RELEVANCE.equals(sortProperty) || Result.DISTANCE.equals(sortProperty)) {
                query.setFields("*", RELEVANCE_SORT_FIELD);
                query.setSortField(RELEVANCE_SORT_FIELD, order);
            } else if (sortProperty.equals(Result.TEMPORAL)) {
                query.addSortField(
                        resolver.getField(Metacard.EFFECTIVE, AttributeFormat.DATE, false), order);
            } else {

                List<String> resolvedProperties = resolver.getAnonymousField(sortProperty);

                if (!resolvedProperties.isEmpty()) {
                    for (String sortField : resolvedProperties) {
                        query.addSortField(sortField, order);
                    }

                    query.add("fl", "*," + RELEVANCE_SORT_FIELD);
                } else {
                    LOGGER.info("No schema field was found for sort property [{}]. No sort field was added to the query.", sortProperty);
                }

            }

        }

        List<SolrQuery> sourceQueries = new ArrayList<SolrQuery>();
        for (String source : request.getSourceIds()) {
            sourceQueries.add(
                    solrFilterDelegate.propertyIsEqualTo(StringUtils.removeEnd(SchemaFields
                                    .METACARD_SOURCE_NAME, SchemaFields.TEXT_SUFFIX),
                            source, true));
        }
        if (sourceQueries.size() > 0) {
            SolrQuery allSourcesQuery;
            if (sourceQueries.size() > 1) {
                allSourcesQuery = solrFilterDelegate.or(sourceQueries);
            } else {
                allSourcesQuery = sourceQueries.get(0);
            }
            query = solrFilterDelegate.and(Lists.newArrayList(query, allSourcesQuery));
        }

        /* Start Index */
        if (request.getQuery().getStartIndex() < 1) {
            throw new UnsupportedQueryException("Start index must be greater than 0");
        }

        // solr is 0-based
        query.setStart(request.getQuery().getStartIndex() - 1);

        try {
            QueryResponse solrResponse = server.query(query, METHOD.POST);

            totalHits = solrResponse.getResults().getNumFound();

            SolrDocumentList docs = solrResponse.getResults();

            for (SolrDocument doc : docs) {

                if (LOGGER.isDebugEnabled()) {
                    LOGGER.debug("SOLR DOC:{}", doc.getFieldValue(Metacard.ID + SchemaFields.TEXT_SUFFIX));
                }
                ResultImpl tmpResult;
                try {
                    tmpResult = createResult(doc, sortProperty);
                    // TODO: register metacard type???
                } catch (MetacardCreationException e) {
                    LOGGER.warn("Metacard creation exception creating result", e);
                    throw new UnsupportedQueryException("Could not create metacard(s).");
                }

                results.add(tmpResult);
            }

        } catch (SolrServerException e) {
            LOGGER.warn("Failure in Solr server query.", e);
            throw new UnsupportedQueryException("Could not complete solr query.");
        } catch (SolrException e) {
            LOGGER.error("Could not complete solr query.", e);
            throw new UnsupportedQueryException("Could not complete solr query.");
        }

        SourceResponseImpl sourceResponseImpl = new SourceResponseImpl(request, results);

        /* Total Count */
        sourceResponseImpl.setHits(totalHits);

        return sourceResponseImpl;
    }

    private Double degreesToMeters(double distance) {
        return new Distance(
                DistanceUtils.degrees2Dist(distance, DistanceUtils.EARTH_MEAN_RADIUS_KM),
                LinearUnit.KILOMETER).getAs(LinearUnit.METER);
    }

    public void create(List<Metacard> metacards) {

        if (metacards == null || metacards.size() == 0) {
            return;
        }

        List<SolrInputDocument> docs = new ArrayList<SolrInputDocument>();

        for (Metacard metacard : metacards) {

            if (metacard != null) {
                boolean isSourceIdSet = (metacard.getSourceId() != null && !"".equals(metacard
                        .getSourceId()));
                boolean isMetacardIdSet = (metacard.getId() != null && !metacard.getId().equals(""));

                if (isSourceIdSet && isMetacardIdSet) {

                    SolrInputDocument solrInputDocument = new SolrInputDocument();

                    try {
                        resolver.addFields(metacard, solrInputDocument);
                    } catch (MetacardCreationException e) {
                        LOGGER.warn("Metacard creation exception adding fields", e);
                        return;
                    }

                    if (StringUtils.isNotBlank(metacard.getSourceId())) {
                        solrInputDocument.addField(SchemaFields.METACARD_SOURCE_NAME, metacard.getSourceId());
                    }

                    docs.add(solrInputDocument);
                }
            } else {
                LOGGER.debug("metacard in result was null");
            }
        }

        try {
            if (!isForcedAutoCommit()) {
                dirty.set(true);
                server.add(docs);
            } else {
                softCommit(docs);
            }
        } catch (SolrServerException e) {
            LOGGER.warn("SOLR server exception ingesting metacard(s)", e);
        } catch (SolrException e) {
            LOGGER.warn("SOLR exception ingesting metacard(s)", e);
        } catch (IOException e) {
            LOGGER.warn("IO exception ingesting metacard(s)", e);
        }
    }

    public void delete(DeleteRequest deleteRequest) throws IngestException {

        if (deleteRequest == null) {
            throw new IngestException(REQUEST_MUST_NOT_BE_NULL_MESSAGE);
        }

        List<Metacard> deletedMetacards = new ArrayList<Metacard>();

        String attributeName = deleteRequest.getAttributeName();

        if (attributeName == null) {
            throw new IngestException(
                    "Attribute name cannot be null. Please provide the name of the attribute.");
        }

        @SuppressWarnings("unchecked")
        List<? extends Serializable> identifiers = deleteRequest.getAttributeValues();

        if (identifiers == null || identifiers.size() == 0) {
            return;
        }

        /* 1. Query first for the records */

        StringBuilder queryBuilder = new StringBuilder();

        for (int i = 0; i < identifiers.size(); i++) {

            if (i != 0) {
                queryBuilder.append(" OR ");
            }

            queryBuilder.append(attributeName + SchemaFields.TEXT_SUFFIX + ":" + QUOTE
                    + identifiers.get(i) + QUOTE);

        }

        SolrQuery query = new SolrQuery(queryBuilder.toString());
        query.setRows(identifiers.size());

        QueryResponse solrResponse = null;

        try {
            solrResponse = server.query(query, METHOD.POST);
        } catch (SolrServerException e) {
            LOGGER.info("SOLR server exception deleting request message", e);
            throw new IngestException(COULD_NOT_COMPLETE_DELETE_REQUEST_MESSAGE);
        }

        SolrDocumentList docs = solrResponse.getResults();

        for (SolrDocument doc : docs) {

            if (LOGGER.isDebugEnabled()) {
                LOGGER.debug("SOLR DOC: {}", doc.getFieldValue(Metacard.ID + SchemaFields.TEXT_SUFFIX));
            }

            try {
                deletedMetacards.add(createMetacard(doc));
            } catch (MetacardCreationException e) {
                LOGGER.info("Metacard creation exception creating metacards during delete", e);
                throw new IngestException("Could not create metacard(s).");
            }

        }
        /* 2. Delete */

        try {
            if (Metacard.ID.equals(attributeName)) {
                LOGGER.debug("identifiers to be deleted: " + StringUtils.join(identifiers, ","));
                server.deleteById((List<String>) identifiers);
            } else {
                // solr deleteByQuery(queryBuilder.toString()) does not work,
                // SOLR BUG back in 4.0.0
                // so we have to delete by id
                List<String> metacardIdentfiers = new ArrayList<String>();
                for (Metacard deletedMetacard : deletedMetacards) {
                    metacardIdentfiers.add(deletedMetacard.getId());
                }
                if (!metacardIdentfiers.isEmpty()) {
                    LOGGER.debug("metacard identifiers to be deleted: " + StringUtils.join(metacardIdentfiers, ","));
                    server.deleteById(metacardIdentfiers);
                } else {
                    LOGGER.debug("No metacard identifiers to be deleted");
                }
            }
        } catch (SolrServerException e) {
            LOGGER.error("SOLR server exception deleting request message", e);
            throw new IngestException(COULD_NOT_COMPLETE_DELETE_REQUEST_MESSAGE);
        } catch (IOException e) {
            LOGGER.error("IO exception deleting request message", e);
            throw new IngestException(COULD_NOT_COMPLETE_DELETE_REQUEST_MESSAGE);
        }
    }

    /**
     * @param docs
     * @return
     * @throws SolrServerException
     * @throws java.io.IOException
     */
    private org.apache.solr.client.solrj.response.UpdateResponse softCommit(
            List<SolrInputDocument> docs) throws SolrServerException, IOException {
        boolean waitForFlush = true;
        boolean waitToMakeVisible = true;
        boolean softCommit = true;
        return new org.apache.solr.client.solrj.request.UpdateRequest().add(docs)
                .setAction(ACTION.COMMIT, waitForFlush, waitToMakeVisible, softCommit)
                .process(server);
    }

    private ResultImpl createResult(SolrDocument doc, String sortProperty)
        throws MetacardCreationException {

        ResultImpl result = new ResultImpl(createMetacard(doc));

        if (doc.get(RELEVANCE_SORT_FIELD) != null) {

            if (Result.RELEVANCE.equals(sortProperty)) {

                result.setRelevanceScore(((Float) (doc.get(RELEVANCE_SORT_FIELD))).doubleValue());

            } else if (Result.DISTANCE.equals(sortProperty)) {
                Object distance = doc.getFieldValue(RELEVANCE_SORT_FIELD);

                if (distance != null) {
                    LOGGER.debug("Distance returned from Solr [{}]", distance);
                    double convertedDistance = degreesToMeters(Double.valueOf(distance.toString()));

                    LOGGER.debug("Converted distance into meters [{}]", convertedDistance);
                    result.setDistanceInMeters(convertedDistance);
                }
            }

        }
        return result;
    }

    public void setExpirationIntervalInMinutes(long expirationInterval) {
        this.expirationIntervalInMinutes = expirationInterval;
        configureCacheExpirationScheduler();
    }

    private void configureCacheExpirationScheduler() {
        shutdownCacheExpirationScheduler();
        LOGGER.info("Configuring cache expiration scheduler with an expiration interval of {} minute(s).", expirationIntervalInMinutes);
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(new ExpirationRunner(), expirationIntervalInMinutes, expirationIntervalInMinutes, TimeUnit.MINUTES);
    }

    private void shutdownCacheExpirationScheduler() {
        if(scheduler != null && !scheduler.isShutdown()) {
            LOGGER.debug("Shutting down cache expiration scheduler.");
            scheduler.shutdown();
            try {
                // Wait up to 60 seconds existing tasks to terminate
                if(!scheduler.awaitTermination(60, TimeUnit.SECONDS)) {
                    scheduler.shutdownNow();
                    // Wait up to 60 seconds for tasks to respond to being cancelled
                    if (!scheduler.awaitTermination(60, TimeUnit.SECONDS)) {
                        LOGGER.warn("Cache expiration scheduler did not terminate.");
                    }
                }
            } catch(InterruptedException e) {
                // (Recancel/cancel if current thread also interrupted
                scheduler.shutdownNow();
                // Preserve interrupt status
                Thread.currentThread().interrupt();
            }
        } else {
            LOGGER.debug("Cache expiration scheduler already shutdown.");
        }
    }

    public void updateServer(String newUrl) {
        updateServer(newUrl, false);
    }

    public void updateServer(String newUrl, boolean keystoreUpdate) {
        LOGGER.info("New url {}", newUrl);

        if (newUrl != null) {

            if (!StringUtils.equalsIgnoreCase(newUrl.trim(), url) || server == null || keystoreUpdate) {

                this.url = newUrl.trim();

                if (server != null) {
                    LOGGER.info("Shutting down the connection manager to the Solr Server and releasing allocated resources.");
                    server.shutdown();
                    LOGGER.info("Shutdown complete.");
                }

                if (StringUtils.startsWith(this.url, "https") && StringUtils.isNotBlank(truststoreLoc)
                        && StringUtils.isNotBlank(truststorePass)
                        && StringUtils.isNotBlank(keystoreLoc)
                        && StringUtils.isNotBlank(keystorePass)) {
                    server = SolrServerFactory
                            .getHttpSolrServer(url, METACARD_CACHE_CORE_NAME, SolrServerFactory.DEFAULT_SOLRCONFIG_XML, getHttpClient());
                } else if(!StringUtils.startsWith(this.url, "https")) {
                    server = SolrServerFactory
                            .getHttpSolrServer(url, METACARD_CACHE_CORE_NAME);
                }
            }
        } else {
            // sets to null
            this.url = newUrl;
        }
    }

    /**
     * Given a document from the server, this method creates a {@link ddf.catalog.data.Metacard}. It populates the
     * source id and {@link ddf.catalog.data.MetacardType}, as well as all the fields from the {@link SolrDocument}
     *
     * @param doc
     *            {@link SolrDocument} from the Solr Server
     * @return a metacard
     * @throws ddf.catalog.data.MetacardCreationException
     */
    private MetacardImpl createMetacard(SolrDocument doc) throws MetacardCreationException {

        MetacardType metacardType = resolver.getMetacardType(doc);

        MetacardImpl metacard = new MetacardImpl(metacardType);

        for (String solrFieldName : doc.getFieldNames()) {
            if (!resolver.isPrivateField(solrFieldName)) {
                Serializable value = resolver.getDocValue(solrFieldName,
                        doc.getFieldValue(solrFieldName));
                metacard.setAttribute(resolver.resolveFieldName(solrFieldName), value);
            }
        }

        metacard.setSourceId(resolver.getMetacardSource(doc));

        return metacard;
    }

    public void forceCommit() {
        try {
            if (dirty.compareAndSet(true, false)) {
                server.commit();
            }
        } catch (SolrServerException e) {
            LOGGER.warn("Unable to commit changes to cache.", e);
        } catch (IOException e) {
            LOGGER.warn("Unable to commit changes to cache.", e);
        }
    }

    public boolean isForcedAutoCommit() {
        return false;
    }

    public void shutdown() {
        LOGGER.info("Shutting down cache expiration scheduler.");
        shutdownCacheExpirationScheduler();
        LOGGER.info("Shutting down solr server.");
        server.shutdown();
    }

    private class ExpirationRunner implements Runnable {

        @Override
        public void run() {
            try {
                LOGGER.debug("Expiring cache.");
                server.deleteByQuery(SchemaFields.CACHED_DATE + ":[* TO NOW-10MINUTES]");
            } catch (SolrServerException e) {
                LOGGER.warn("Unable to expire cache.", e);
            } catch (IOException e) {
                LOGGER.warn("Unable to expire cache.", e);
            }
        }
    }

    private CloseableHttpClient getHttpClient() {
        // Allow TLS protocol and secure ciphers only
        SSLConnectionSocketFactory sslConnectionSocketFactory = new SSLConnectionSocketFactory(
                getSslContext(),
                new String[] {
                        "TLSv1",
                        "TLSv1.1",
                        "TLSv1.2"
                },
                new String[] {
                        "TLS_DHE_RSA_WITH_AES_128_CBC_SHA",
                        "TLS_DHE_RSA_WITH_AES_128_CBC_SHA",
                        "TLS_DHE_DSS_WITH_AES_128_CBC_SHA",
                        "TLS_RSA_WITH_AES_128_CBC_SHA"
                },
                SSLConnectionSocketFactory.BROWSER_COMPATIBLE_HOSTNAME_VERIFIER);

        return HttpClients.custom()
                .setSSLSocketFactory(sslConnectionSocketFactory)
                .setDefaultCookieStore(new BasicCookieStore())
                .setMaxConnTotal(128)
                .setMaxConnPerRoute(32)
                .build();
    }

    private SSLContext getSslContext() {
        KeyStore trustStore = getKeyStore(truststoreLoc, truststorePass);
        KeyStore keyStore = getKeyStore(keystoreLoc, keystorePass);

        SSLContext sslContext = null;

        try {
            sslContext = SSLContexts.custom()
                    .loadKeyMaterial(keyStore, keystorePass.toCharArray())
                    .loadTrustMaterial(trustStore)
                    .useTLS()
                    .build();
        } catch (UnrecoverableKeyException | NoSuchAlgorithmException | KeyStoreException |
                KeyManagementException e) {
            LOGGER.error("Unable to create secure HttpClient", e);
            return null;
        }

        sslContext.getDefaultSSLParameters().setNeedClientAuth(true);
        sslContext.getDefaultSSLParameters().setWantClientAuth(true);

        return sslContext;
    }

    private KeyStore getKeyStore(String location, String password) {
        LOGGER.debug("Loading keystore from {}", location);
        KeyStore keyStore = null;

        try (FileInputStream storeStream = new FileInputStream(location)) {
            keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
            keyStore.load(storeStream, password.toCharArray());
        } catch (CertificateException | IOException
                | NoSuchAlgorithmException | KeyStoreException e) {
            LOGGER.error("Unable to load keystore at " + location, e);
        }

        return keyStore;
    }

    public void setEncryptService(EncryptionService encryptService) {
        this.encryptService = encryptService;
    }

    @Override
    public void configurationUpdateCallback(Map<String, String> props) {
        LOGGER.debug("Got a new configuration.");
        String keystoreLocation = props.get(ConfigurationManager.KEY_STORE);
        String keystorePassword = encryptService.decryptValue(props
                .get(ConfigurationManager.KEY_STORE_PASSWORD));

        String truststoreLocation = props.get(ConfigurationManager.TRUST_STORE);
        String truststorePassword = encryptService.decryptValue(props
                .get(ConfigurationManager.TRUST_STORE_PASSWORD));

        boolean keystoresUpdated = false;

        if (StringUtils.isNotBlank(keystoreLocation)
                && (!StringUtils.equals(this.keystoreLoc, keystoreLocation) || !StringUtils.equals(
                this.keystorePass, keystorePassword))) {
            if (new File(keystoreLocation).exists()) {
                LOGGER.debug("Detected a change in the values for the keystore.");
                this.keystoreLoc = keystoreLocation;
                this.keystorePass = keystorePassword;
                keystoresUpdated = true;
            } else {
                LOGGER.debug(
                        "Keystore file does not exist at location {}, not updating keystore values.");
            }
        }
        if (StringUtils.isNotBlank(truststoreLocation)
                && (!StringUtils.equals(this.truststoreLoc, truststoreLocation) || !StringUtils
                .equals(this.truststorePass, truststorePassword))) {
            if (new File(truststoreLocation).exists()) {
                LOGGER.debug("Detected a change in the values for the truststore.");
                this.truststoreLoc = truststoreLocation;
                this.truststorePass = truststorePassword;
                keystoresUpdated = true;
            } else {
                LOGGER.debug(
                        "Truststore file does not exist at location {}, not updating truststore values.");
            }
        }

        if (keystoresUpdated) {
            updateServer(this.url, keystoresUpdated);
        }

    }
}
