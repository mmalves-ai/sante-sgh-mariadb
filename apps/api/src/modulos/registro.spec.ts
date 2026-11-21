// Registro dos módulos (F2-L): API_MODULOS monta a base e só os módulos migrados; nome desconhecido recusa a partida.
import { Module } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../autorizacao/trilha.js';
import { lerConfiguracao } from '../configuracao.js';
import { ArmazemMemoria } from '../sessao/armazem.js';
import {
  API_MODULOS_PADRAO,
  type CarregadorModulo,
  type ContextoModulo,
  carregarModulos,
  modulosPedidos,
  recusaDosModulos,
} from './registro.js';

@Module({})
class ModuloExemplo {}

const exemplo: CarregadorModulo = () => Promise.resolve({ modulo: () => ({ module: ModuloExemplo }) });
const registro = { exemplo };

function contexto(env: Record<string, string>): ContextoModulo {
  return {
    configuracao: lerConfiguracao(env),
    nucleo: null,
    env,
    armazem: new ArmazemMemoria(),
    servico: null,
    trilha: new RegistradorTrilhaMemoria(),
  };
}

describe('API_MODULOS', () => {
  it('padrão: só a base (sessao, autorizacao, sistema), nenhum módulo extra', () => {
    expect(API_MODULOS_PADRAO).toBe('sessao,autorizacao,sistema');
    expect(modulosPedidos({})).toEqual([]);
    expect(modulosPedidos({ API_MODULOS: 'sessao, sistema' })).toEqual([]);
    expect(recusaDosModulos({})).toBeNull();
  });

  it('nome desconhecido ou ainda não migrado: recusa a partida, com a mensagem', () => {
    const r = recusaDosModulos({ API_MODULOS: 'sessao,inexistente' });
    expect(r).toMatch(/inexistente/);
    expect(r).toMatch(/ainda não migrado/);
    expect(recusaDosModulos({ API_MODULOS: 'todos,sessao' })).toMatch(/todos/);
  });

  it('"todos": a base e todos os registrados (F2.2, até a onda 4 das ondas finais)', () => {
    expect(modulosPedidos({ API_MODULOS: 'todos' })).toEqual([
      'acesso',
      'administracao',
      'adt',
      'agenda',
      'assinatura',
      'atendimento',
      'cadastro',
      'carga',
      'catalogos',
      'cirurgia',
      'config',
      'consultas',
      'contabil',
      'contratualizacao',
      'custos',
      'digitalizacao',
      'documento',
      'enfermagem',
      'especialidades',
      'exames',
      'farmacia',
      'faturamento',
      'financeiro',
      'implantacao',
      'integracao',
      'internacao',
      'manutencao',
      'nutricao',
      'operadora',
      'orcamento',
      'patrimonio',
      'pep',
      'pessoas',
      'plataforma-onboarding',
      'portal-medico',
      'portal-paciente',
      'portaria',
      'precos',
      'qualidade',
      'recepcao',
      'rede',
      'relatorio',
      'repasse',
      'rouparia',
      'sadt',
      'sessoes',
      'suporte',
      'suprimentos',
      'sus',
      'telemedicina',
      'tiss',
    ]);
    expect(recusaDosModulos({ API_MODULOS: 'sessao,cadastro,atendimento' })).toBeNull();
    expect(modulosPedidos({ API_MODULOS: 'todos' }, registro)).toEqual(['exemplo']);
  });

  it('carrega os módulos migrados pedidos', async () => {
    const env = { API_MODULOS: 'sessao,exemplo', AMBIENTE: 'ci' };
    const m = await carregarModulos(contexto(env), registro);
    expect(m.map((x) => x.module)).toEqual([ModuloExemplo]);
    expect(await carregarModulos(contexto({ AMBIENTE: 'ci' }), registro)).toEqual([]);
  });
});
