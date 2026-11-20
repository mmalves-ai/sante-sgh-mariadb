// M06: o núcleo lê as concessões, os escopos, o parâmetro de vínculo e as tabelas SGH_ do acesso (READ ONLY),
// e grava só SGH_ pela transação SGH_ (quebra de vidro, trilha própria). Dublê do driver; dados sintéticos.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ambienteFicticio, criarDubleDriver, type Responder } from './duble-driver.spec-util.js';
import { NucleoLegado, somenteSgh } from './legado.js';
import { escritorDuble } from './duble-escritor.spec-util.js';
import { instanteDoBanco } from './codec.js';

const pasta = mkdtempSync(join(tmpdir(), 'sgh-nucleo-acesso-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

const agora = new Date('2026-10-20T10:00:00Z');
const vistos: { sql: string; parametros: readonly unknown[] }[] = [];
const responder: Responder = (sql, parametros) => {
  vistos.push({ sql, parametros });
  if (sql.includes('SELECT GRUPO FROM TBUSERS')) return [{ GRUPO: 'MEDICOS   ' }];
  if (sql.includes('FROM TBPERUSU WHERE GRUPO')) return [{ ID_TBOPCOES: 10 }, { ID_TBOPCOES: 11 }];
  if (sql.includes('SELECT DISTINCT p.COD_PAPEL')) return [{ COD_PAPEL: 4 }];
  if (sql.includes('SELECT DISTINCT po.ID_TBOPCOES')) return [{ ID_TBOPCOES: 12 }];
  if (sql.includes('FROM GEUSERS WHERE')) return [{ PERMITIR_AUTORIZAR_PEDIDO: 'S' }];
  if (sql.includes('JOIN TBCBOPRO')) return [{ C: 1 }];
  if (sql.includes('FROM RICADPAC')) return [{ PRONT: 900, TIPOPAC: 'I', OTMU: 'A' }];
  if (sql.includes('INSERT INTO SGH_OUTBOX')) return [{ ID: '11' }];
  if (sql.includes('SELECT ID_TBUSERS FROM TBUSERS')) return [{ ID_TBUSERS: 7 }];
  if (sql.includes('FROM TBUNIUSE')) return [{ V: 2 }, { V: 1 }, { V: 2 }];
  if (sql.includes('FROM TBUSERS_TBCONVEN')) return [{ V: 30 }];
  if (sql.includes('FROM TBUSERCON')) return [{ V: '30' }, { V: '31' }];
  if (sql.includes('FROM PRPARAM')) return [{ R: 'F' }];
  if (sql.includes('FROM SGH_ACESSO_PERFIL_USUARIO'))
    return [
      { PERFIL: 'auditor', INICIO: agora, FIM: null },
      { PERFIL: 'x', INICIO: null, FIM: null },
    ];
  if (sql.includes('FROM SGH_ACESSO_MAPA_OPCAO'))
    return [{ PERFIL: 'auditor', PERMISSAO: 'sistema.saude.ler' }];
  if (sql.includes('FROM SGH_ACESSO_EMERGENCIA')) return [{ ID: '5', FIM: agora }];
  if (sql.includes('NEXT VALUE FOR SGH_GEN_ACESSO_EMERGENCIA'))
    return [{ ID: '5', I: agora, F: new Date(agora.getTime() + 3_600_000) }];
  if (sql.includes('FROM SGH_TRILHA')) return [];
  if (sql.includes('NEXT VALUE FOR SGH_GEN_TRILHA'))
    return [{ ID: '9', H: '2026-10-20 10:00:00.0000', D: '2026-10-20' }];
  return [];
};

function nucleo() {
  return new NucleoLegado({
    env: ambienteFicticio(['pc']),
    driver: criarDubleDriver(responder),
    pastaHomologada: pasta,
  });
}

describe('núcleo: acesso do M06', () => {
  it('concessões, escopos (sem repetição, ordenados), vínculo e as tabelas SGH_ do acesso', async () => {
    const n = nucleo();
    try {
      const d = await n.dadosDeAutorizacao('pc', 'SINT.X', [
        { tabela: 'GEUSERS', coluna: 'PERMITIR_AUTORIZAR_PEDIDO' },
        { tabela: 'GEUSERS', coluna: 'PERMITIR_AUTORIZAR_PEDIDO' },
      ]);
      expect(d.concessoes).toEqual({
        grupo: 'MEDICOS',
        opcoesGrupo: [10, 11],
        opcoesPapel: [12],
        papeis: [4],
        flags: ['GEUSERS.PERMITIR_AUTORIZAR_PEDIDO'],
        conselho: true,
      });
      expect(d.escopos.unidades).toEqual(['1', '2']);
      expect(d.escopos.convenios).toEqual(['30', '31']);
      expect(d.restricaoVinculo).toBe(false);
      // O banco devolve a hora civil (-03:00); o adaptador entrega o instante real.
      expect(d.perfisConcedidos).toEqual([{ perfil: 'auditor', inicio: instanteDoBanco(agora), fim: null }]);
      expect(d.mapaPerfis).toEqual([{ perfil: 'auditor', permissao: 'sistema.saude.ler' }]);
      await expect(n.concessoesDoUsuario('pc', 'SINT.X')).resolves.toMatchObject({
        grupo: 'MEDICOS',
        flags: [],
      });
      await expect(n.escoposDoUsuario('pc', 'SINT.X')).resolves.toMatchObject({ locais: [] });
      await expect(n.restricaoVinculo('pc')).resolves.toBe(false);
      await expect(n.emergenciaVigente('pc', 'SINT.X', 1)).resolves.toEqual({
        id: '5',
        fim: instanteDoBanco(agora),
      });
      await expect(
        n.concessoesDoUsuario('pc', 'SINT.X', [{ tabela: 'TBUSUCPL', coluna: 'nao valida' }]),
      ).rejects.toThrow(/coluna inválida/);
    } finally {
      await n.encerrar();
    }
  });

  it('gravação só SGH_: quebra de vidro e trilha própria na transação SGH_; tabela do legado recusada', async () => {
    const n = nucleo();
    try {
      const ctx = { rede: 'rede-teste', hospital: 'pc', traceId: 'teste' };
      const linha = {
        rede: 'rede-teste',
        hospital: 'pc',
        usuario: 'SINT.X',
        evento: 'acesso.emergencia.aberta',
        recurso: 'acesso.emergencia',
        operacao: 'acesso.abrirEmergencia',
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: null,
        correlacao: 'c',
      };
      const r = await n.registrarEmergencia(
        ctx,
        {
          rede: 'rede-teste',
          hospital: 'pc',
          idUsuario: 1,
          login: 'SINT.X',
          idPaciente: 9,
          atendimento: null,
          motivo: 'outro',
          justificativa: 'justificativa sintética longa',
          minutos: 60,
        },
        linha,
      );
      expect(r).toMatchObject({ id: '5', trilha: '9' });
      // Paciente conferido em RICADPAC e o alerta ao Auditor na SGH_OUTBOX da MESMA transação (só códigos).
      expect(vistos.some((v) => /FROM RICADPAC WHERE ID = \?/.test(v.sql))).toBe(true);
      const outbox = vistos.find((v) => v.sql.includes('INSERT INTO SGH_OUTBOX'));
      expect(outbox?.parametros[2]).toBe('alerta-emergencia');
      expect(String(outbox?.parametros[4])).toContain('"idEmergencia":"5"');
      expect(String(outbox?.parametros[4])).not.toContain('justificativa');
      await expect(
        n.registrarTrilhaPropria(ctx, { ...linha, tabelaAlvo: null, idAlvo: null }),
      ).resolves.toMatchObject({ id: '9' });
      await expect(
        n.gravarSgh(ctx, (e) => e.executar('INSERT INTO TBUSERS (NOME) VALUES (?)', ['X'])),
      ).rejects.toThrow(/só .* tabela SGH_/);
    } finally {
      await n.encerrar();
    }
  });

  it('o escritor SGH_ recusa UPDATE/DELETE/MERGE em tabela do legado e comando sem alvo', async () => {
    const e = somenteSgh(escritorDuble(() => 1));
    await expect(e.executar('UPDATE SGH_TRILHA SET X = 1')).resolves.toBe(1);
    await expect(
      e.executarRetornando('INSERT INTO SGH_ACESSO_EMERGENCIA (ID) VALUES (1) RETURNING ID'),
    ).resolves.toEqual({});
    await expect(e.executar('DELETE FROM RICADPAC WHERE ID = 1')).rejects.toThrow();
    await expect(e.executar('EXECUTE PROCEDURE X')).rejects.toThrow();
    await expect(e.consultar('SELECT 1 FROM RDB$DATABASE')).resolves.toEqual([]);
    await expect(e.lerBlob(null)).resolves.toEqual(Buffer.alloc(0));
  });
});
