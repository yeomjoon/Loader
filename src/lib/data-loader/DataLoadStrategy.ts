import { Service, ServiceStatus } from '../../entity/manager/Service';
import { Application } from '../../entity/manager/Application';
import { Meta } from '../../entity/manager/Meta';
import { QueryRunner } from 'typeorm/query-runner/QueryRunner';
import { getConnection, Table } from 'typeorm';
import { ServiceColumn } from '../../entity/manager/ServiceColumn';
import { TableOptions } from 'typeorm/schema-builder/options/TableOptions';
import { Stage } from '../../entity/manager/Stage';

abstract class DataLoadStrategy {
  tablesForDelete: string[];
  defaultQueryRunner: QueryRunner;

  constructor(defaultQueryRunner: QueryRunner) {
    this.tablesForDelete = [];
    this.defaultQueryRunner = defaultQueryRunner;
  }
  
  async load(stage: Stage,service:Service) {
    const datasetQueryRunner = await getConnection('dataset').createQueryRunner();
    return new Promise(async (resolve, reject) => {
      try {
        service.stage = stage;
        const meta = service.meta;  
        const metaColumns = meta.columns;
        service.tableName = `${stage.application.id}-${stage.id}-${service.id}`
        // column data 생성
        let columns = []
        let columnNames = []
        let originalColumnNames = []
        let serviceColumns: ServiceColumn[] = []

        metaColumns.forEach(column => {
          columnNames.push(`\`${column.columnName}\``)
          originalColumnNames.push(`\`${column.originalColumnName}\``)
          let type = column.type.toString();
          if(column.size) {
            type = `${type}(${column.size})`
          }
          columns.push({
            name: column.columnName,
            type: column.type,
            isNullable: true
          })
          serviceColumns.push(new ServiceColumn(column.columnName, type, service));
        });

        const tableOption: TableOptions = {
          name: service.tableName,
          columns: columns
        }

        let insertQuery = `INSERT INTO \`${tableOption.name}\`(${columnNames.join(",")}) VALUES ?`;

        let insertValues = await this.generateRows(meta, originalColumnNames);
        this.tablesForDelete.push(tableOption.name);
        await datasetQueryRunner.dropTable(service.tableName, true);
        await datasetQueryRunner.createTable(new Table(tableOption));
        await datasetQueryRunner.query(insertQuery, [insertValues]);
        meta.isActive = true;
        service.status = ServiceStatus.LOADED;
        await this.defaultQueryRunner.manager.save(meta);
        await this.defaultQueryRunner.manager.save(service);
        await this.defaultQueryRunner.manager.save(serviceColumns);
        resolve();
      } catch(err) {
        service.status = ServiceStatus.FAILED;
        await this.defaultQueryRunner.manager.save(service);
        reject(err);
      }
    })
  };

  abstract async generateRows(meta:Meta, originalColumnNames:string[]);
}

export default DataLoadStrategy;