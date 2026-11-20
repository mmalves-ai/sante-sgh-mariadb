// Contratos do ponto (M52.4): as entradas, as permissões pelas opções do outro sistema (a ciência para toda pessoa), a
// chave de liberação desligada por padrão, os eventos auditáveis e a biometria desligada por padrão (regra 15).
import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import { definicaoParametro } from '../parametros/definicoes.js';
import { PERMISSOES_PESSOAS_M52_F4 } from '../permissoes/pessoas-ponto.js';
import {
  esquemaAcertoBanco,
  esquemaCienciaEspelho,
  esquemaDecidirAjuste,
  esquemaFiltroPonto,
  esquemaImportarAfd,
  esquemaLancarAjuste,
  esquemaRegraBanco,
} from './ponto-entradas.js';
import {
  CHAVE_PESSOAS_PONTO,
  CLASSES_HORA,
  EVENTOS_FOLHA,
  PARAMETRO_BIOMETRIA_PONTO,
} from './ponto-vocabulario.js';

const base = { vinculo: 1, dia: '2026-09-02', motivo: 'Relógio parado no plantão' };

describe('contratos do ponto (M52.4)', () => {
  it('ajuste: inclusão pede o horário; desconsiderar pede a marcação; justificativa pede o tipo; motivo de 10 caracteres', () => {
    expect(
      esquemaLancarAjuste.safeParse({ ...base, tipo: 'inclusao', instante: '2026-09-02T07:00' }).success,
    ).toBe(true);
    expect(esquemaLancarAjuste.safeParse({ ...base, tipo: 'inclusao' }).success).toBe(false);
    expect(esquemaLancarAjuste.safeParse({ ...base, tipo: 'desconsiderar' }).success).toBe(false);
    expect(esquemaLancarAjuste.safeParse({ ...base, tipo: 'justificativa', movimento: 7 }).success).toBe(
      true,
    );
    expect(esquemaLancarAjuste.safeParse({ ...base, tipo: 'justificativa' }).success).toBe(false);
    expect(
      esquemaLancarAjuste.safeParse({ ...base, motivo: 'curto', tipo: 'justificativa', movimento: 7 })
        .success,
    ).toBe(false);
  });

  it('decisão: recusa com motivo; ciência com discordância explicada; acerto e regra do banco', () => {
    expect(esquemaDecidirAjuste.safeParse({ ajuste: 1, decisao: 'aprovar' }).success).toBe(true);
    expect(esquemaDecidirAjuste.safeParse({ ajuste: 1, decisao: 'recusar' }).success).toBe(false);
    const h = 'a'.repeat(64);
    expect(
      esquemaCienciaEspelho.safeParse({ vinculo: 1, competencia: '2026-09', hash: h, concorda: true })
        .success,
    ).toBe(true);
    expect(
      esquemaCienciaEspelho.safeParse({ vinculo: 1, competencia: '2026-09', hash: h, concorda: false })
        .success,
    ).toBe(false);
    expect(
      esquemaAcertoBanco.safeParse({
        vinculo: 1,
        competencia: '2026-09',
        minutos: -30,
        motivo: 'Acerto do saldo inicial',
      }).success,
    ).toBe(true);
    expect(
      esquemaRegraBanco.safeParse({ regime: 1, destino: 2, inicio: 4, desde: '2026-01', cicloMeses: 6 })
        .success,
    ).toBe(true);
    expect(
      esquemaRegraBanco.safeParse({ regime: 1, destino: 4, inicio: 4, desde: '2026-01', cicloMeses: 6 })
        .success,
    ).toBe(false);
  });

  it('importação: o teto do arquivo; o filtro do painel', () => {
    expect(esquemaImportarAfd.safeParse({ nome: 'a.txt', tipoRep: 'REP-C', conteudo: 'x' }).success).toBe(
      true,
    );
    expect(
      esquemaImportarAfd.safeParse({ nome: 'a.txt', tipoRep: 'REP-C', conteudo: 'x'.repeat(1_000_001) })
        .success,
    ).toBe(false);
    expect(esquemaFiltroPonto.parse({ competencia: '2026-09', pagina: '2' })).toMatchObject({
      pagina: 2,
      limite: 50,
      situacao: 'todos',
    });
  });

  it('permissões: opções do ponto do outro sistema; a ciência é de toda pessoa; nenhuma clínica', () => {
    const por = new Map(PERMISSOES_PESSOAS_M52_F4.map((p) => [p.codigo, p]));
    expect([...por.keys()]).toEqual([
      'pessoas.ponto.ler',
      'pessoas.ponto.importar',
      'pessoas.ponto.justificar',
      'pessoas.ponto.aprovar',
      'pessoas.ponto.exportar',
      'pessoas.ponto.ciencia',
    ]);
    expect(por.get('pessoas.ponto.importar')?.opcoesLegado).toEqual([5067, 5068]);
    expect(por.get('pessoas.ponto.ciencia')).toMatchObject({
      opcoesLegado: [],
      concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    });
    expect(PERMISSOES_PESSOAS_M52_F4.every((p) => p.categoria === 'administrativa')).toBe(true);
  });

  it('chave, eventos auditáveis, domínios e a biometria desligada por padrão (regra 15)', () => {
    expect(RECURSOS_DESLIGADOS.some((r) => r.chave === CHAVE_PESSOAS_PONTO)).toBe(true);
    expect(EVENTOS_AUDITAVEIS.pessoasAfdImportado.codigo).toBe('pessoas.afd.importado');
    expect(EVENTOS_AUDITAVEIS.pessoasPontoLido.codigo).toBe('pessoas.ponto.lido');
    expect(Object.keys(CLASSES_HORA)).toHaveLength(9);
    expect(Object.keys(EVENTOS_FOLHA)).toHaveLength(13);
    expect(definicaoParametro(PARAMETRO_BIOMETRIA_PONTO)).toMatchObject({
      tipo: 'booleano',
      padrao: 'nao',
      critico: true,
    });
    expect(definicaoParametro('pessoas.ponto.leiauteAfd')?.padrao).toBe('003');
  });
});
