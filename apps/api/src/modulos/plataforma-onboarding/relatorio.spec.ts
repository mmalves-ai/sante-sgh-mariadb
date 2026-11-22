// L10 (F4): relatório de conciliação da execução: lista branca pelo contrato, filtro por entidade e regra e a
// exportação em CSV (só agregados; célula com cara de fórmula neutralizada).
import { describe, expect, it } from 'vitest';
import { execucaoDaLinha, filtrarRelatorio, relatorioCsv } from './execucao.js';

const RELATORIO = {
  versao: 1,
  totais: {
    entidades: 2,
    conferidas: 2,
    registrosOrigem: 15,
    registrosDestino: 14,
    recusados: 1,
    abertas: 6,
    criticas: 1,
    resolvidas: 2,
    decisoesCliente: 5,
  },
  porRegra: [
    {
      entidade: 'consulta',
      regra: 'exclusao_em_massa_aguarda_confirmacao',
      gravidade: 'critica',
      abertas: 1,
      resolvidas: 0,
      decisao: 'cliente',
      acao: 'confirmar',
    },
    {
      entidade: 'paciente',
      regra: 'cpf_duplicado',
      gravidade: 'alta',
      abertas: 1,
      resolvidas: 2,
      decisao: 'cliente',
      acao: '=corrigir',
    },
    {
      entidade: 'consulta',
      regra: 'cpf_duplicado',
      gravidade: 'alta',
      abertas: 3,
      resolvidas: 0,
      decisao: 'cliente',
      acao: '=corrigir',
    },
    {
      entidade: 'imagem',
      regra: 'tabela_sem_mapa',
      gravidade: 'alta',
      abertas: 1,
      resolvidas: 0,
      decisao: 'plataforma',
      acao: 'mapear',
    },
  ],
  decisoesCliente: [
    {
      regra: 'exclusao_em_massa_aguarda_confirmacao',
      gravidade: 'critica',
      quantidade: 1,
      entidades: 1,
      acao: 'confirmar',
    },
    { regra: 'cpf_duplicado', gravidade: 'alta', quantidade: 4, entidades: 2, acao: '=corrigir' },
  ],
  naoCarregado: {
    recusados: [{ entidade: 'paciente', recusados: 1 }],
    semMapa: { tabelas: 1, registros: 6 },
    bloqueadas: { tabelas: 0, registros: 0 },
    semCarga: [
      {
        causa: 'mecanismo_do_produto',
        tabelas: 1,
        registros: 3,
        provasConferidas: 1,
        provasFalhas: 0,
        semProva: 0,
      },
    ],
  },
  provas: [
    {
      destino: 'sequencia_negocio',
      causa: 'mecanismo_do_produto',
      tipo: 'mecanismo',
      linhasOrigem: 3,
      iguais: 3,
      divergentes: 0,
      faltandoNoDestino: 0,
      sobrandoNoDestino: 0,
      conferido: true,
    },
  ],
  saidasExternas: 0,
  redeSemRotaExterna: true,
};

const linha = (relatorio: unknown) => ({
  id: 7,
  tipo: 'sincronizar',
  estado: 'concluida',
  contadores: JSON.stringify({
    entidades: {
      paciente: { registros_origem: 10, registros_destino: 9, recusados: 1, conferido: true },
      consulta: { registros_origem: 5, registros_destino: 5, recusados: 0, conferido: true },
    },
    relatorio,
  }),
});

describe('relatório de conciliação (L10)', () => {
  it('passa pelo contrato; fora dele, nenhum', () => {
    expect(execucaoDaLinha(linha(RELATORIO)).relatorio?.totais.resolvidas).toBe(2);
    expect(execucaoDaLinha(linha({ versao: 1, valores: ['x'] })).relatorio).toBeNull();
    expect(execucaoDaLinha(linha(undefined)).relatorio).toBeNull();
  });

  it('filtra por entidade e regra e recalcula as decisões do cliente', () => {
    const r = execucaoDaLinha(linha(RELATORIO)).relatorio!;
    const so = filtrarRelatorio(r, { entidade: 'consulta' });
    expect(so.porRegra.map((p) => p.regra)).toEqual([
      'exclusao_em_massa_aguarda_confirmacao',
      'cpf_duplicado',
    ]);
    expect(so.decisoesCliente.find((d) => d.regra === 'cpf_duplicado')?.quantidade).toBe(3);
    expect(so.naoCarregado.recusados).toEqual([]);
    const regra = filtrarRelatorio(r, { regra: 'cpf_duplicado' });
    expect(regra.decisoesCliente).toEqual([
      { regra: 'cpf_duplicado', gravidade: 'alta', quantidade: 4, entidades: 2, acao: '=corrigir' },
    ]);
    expect(filtrarRelatorio(r, {})).toBe(r);
  });

  it('exporta em CSV com as seções, o filtro e a fórmula neutralizada', () => {
    const e = execucaoDaLinha(linha(RELATORIO));
    const csv = relatorioCsv(e);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('totais;2;2;15;14;1;6;1;2;5;0');
    expect(csv).toContain('entidade;paciente;10;9;1;sim');
    expect(csv).toContain("pendencia;paciente;cpf_duplicado;alta;1;2;cliente;'=corrigir");
    expect(csv).toContain('nao_carregado;fora_do_mapa;1;6');
    expect(csv).toContain('prova;sequencia_negocio;mecanismo_do_produto;mecanismo;3;3;0;0;0;sim');
    const filtrado = relatorioCsv(e, { entidade: 'paciente' });
    expect(filtrado).not.toContain('entidade;consulta');
    expect(filtrado).not.toContain('pendencia;consulta');
    // execução sem relatório (anterior ao L10): só a conciliação por entidade
    expect(relatorioCsv(execucaoDaLinha(linha(undefined)))).toContain('entidade;consulta;5;5;0;sim');
  });
});
