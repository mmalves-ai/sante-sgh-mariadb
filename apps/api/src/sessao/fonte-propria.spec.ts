// Fonte própria sem banco: a política de senha do banco na forma do domínio, o cálculo das permissões pelas ações dos
// perfis do cliente e a falha fechada (sem estabelecimento, sem conta). Dados sintéticos.
import { CATALOGO_DECLARADO } from '@sgh/contratos';
import type { Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { calcularAutorizacao, type DadosAutorizacao } from '../autorizacao/servico-autorizacao.js';
import { FonteAcessoPropria, configDaPolitica, criarFonteAcessoPropria } from './fonte-propria.js';

const POR_PERFIL = CATALOGO_DECLARADO.filter((p) => p.concessaoPorPerfil !== 'todos-os-perfis-de-pessoa').map(
  (p) => p.codigo,
);
const VAZIO = {
  unidades: [],
  locais: [],
  convenios: [],
  centrosCusto: [],
  locaisEstoque: [],
  contasBancarias: [],
  tiposAgenda: [],
  tiposProntuario: [],
};

/** Núcleo falso: responde às consultas pela primeira palavra-chave da tabela. */
function nucleo(respostas: Record<string, unknown[]>) {
  const consultas: string[] = [];
  const leitor: Leitor = {
    cliente: 'teste',
    consultar: <T>(sql: string) => {
      consultas.push(sql);
      const chave = Object.keys(respostas).find((k) => sql.includes(k));
      return Promise.resolve((chave ? respostas[chave] : []) as T[]);
    },
    uma: <T>(sql: string) => {
      consultas.push(sql);
      const chave = Object.keys(respostas).find((k) => sql.includes(k));
      return Promise.resolve(((chave ? respostas[chave] : [])?.[0] ?? null) as T | null);
    },
  } as Leitor;
  return {
    consultas,
    lerSomente: <T>(_c: unknown, fn: (l: Leitor) => Promise<T>) => fn(leitor),
    estadosDosPools: () => [],
  };
}

describe('política de senha do banco', () => {
  it('vira a configuração do login', () => {
    const c = configDaPolitica({
      tamanho_minimo: 12,
      exige_maiuscula: 1,
      exige_minuscula: 0,
      exige_numero: 1,
      exige_especial: 0,
      validade_dias: null,
      tentativas_ate_bloqueio: 5,
      inatividade_sessao_minutos: 30,
      aviso_fim_sessao_minutos: null,
      exige_aceite_periodico: 1,
      periodicidade_aceite_dias: 365,
    });
    expect(c.senha).toMatchObject({
      minimoCaracteres: 12,
      exigeLetra: true,
      exigeMaiuscula: true,
      exigeNumero: true,
      periodoTrocaDias: null,
    });
    expect(c.tempo).toEqual({ inatividadeSegundos: 1800, avisoSegundos: null });
    expect(c).toMatchObject({ termoPeriodico: true, quantidadePeriodoTermo: 365, tipoPeriodoTermo: 'D' });
  });
});

describe('permissões pelas ações dos perfis do cliente', () => {
  const base: DadosAutorizacao = {
    concessoes: { grupo: null, opcoesGrupo: [], opcoesPapel: [], papeis: [], flags: [], conselho: false },
    escopos: VAZIO,
    restricaoVinculo: false,
    perfisConcedidos: [{ perfil: 'RECEPCAO', inicio: new Date(0), fim: null }],
    mapaPerfis: [],
  };
  const [a, b] = [POR_PERFIL[0] ?? '', POR_PERFIL[1] ?? ''];

  it('concede a ação do perfil vigente; ação fora do catálogo do produto é ignorada', () => {
    const r = calcularAutorizacao(
      {
        ...base,
        acoesDoPerfil: [
          { perfil: 'RECEPCAO', permissao: a },
          { perfil: 'OUTRO', permissao: b },
          { perfil: 'RECEPCAO', permissao: 'nao.existe.no.catalogo' },
        ],
      },
      Date.now(),
    );
    expect(r.permissoes).toContain(a);
    expect(r.permissoes).not.toContain(b);
    expect(r.permissoes).not.toContain('nao.existe.no.catalogo');
  });

  it('perfil vencido não concede', () => {
    const r = calcularAutorizacao(
      {
        ...base,
        perfisConcedidos: [{ perfil: 'RECEPCAO', inicio: new Date(0), fim: new Date(1000) }],
        acoesDoPerfil: [{ perfil: 'RECEPCAO', permissao: a }],
      },
      Date.now(),
    );
    expect(r.permissoes).not.toContain(a);
  });

  it('ação negada prevalece sobre o perfil e sobre as concessões gerais do catálogo', () => {
    const geral = CATALOGO_DECLARADO.find((p) => p.concessaoPorPerfil === 'todos-os-perfis-de-pessoa')?.codigo;
    const livre = calcularAutorizacao({ ...base, acoesDoPerfil: [{ perfil: 'RECEPCAO', permissao: a }] }, Date.now());
    const r = calcularAutorizacao(
      {
        ...base,
        acoesDoPerfil: [{ perfil: 'RECEPCAO', permissao: a }],
        acoesNegadas: [a, ...(geral ? [geral] : [])],
      },
      Date.now(),
    );
    expect(r.permissoes).not.toContain(a);
    if (geral && livre.permissoes.includes(geral)) expect(r.permissoes).not.toContain(geral);
  });
});

describe('falha fechada', () => {
  it('estabelecimento fora da lista: senha errada, sem consultar a conta; autorização vazia', async () => {
    const n = nucleo({ estabelecimento: [{ id: 1, codigo: 'hosp', nome_fantasia: 'Hospital' }] });
    const f = new FonteAcessoPropria(n, 'teste', 'rede');
    await f.carregar();
    expect(f.estabelecimentos.map((e) => e.codigo)).toEqual(['hosp']);
    expect((await f.autenticar('outro', 'qualquer', 'x')).desfecho).toBe('credencial-invalida');
    expect(n.consultas.some((s) => s.includes('FROM usuario u'))).toBe(false);
    const d = await f.dadosDeAutorizacao('outro', 'qualquer');
    expect(d.acoesDoPerfil).toEqual([]);
  });

  it('código de estabelecimento fora do formato da sessão fica fora do login, com aviso', async () => {
    const avisos: string[] = [];
    const f = new FonteAcessoPropria(
      nucleo({
        estabelecimento: [
          { id: 1, codigo: 'hosp', nome_fantasia: 'Hospital' },
          { id: 2, codigo: 'Fora Do Formato', nome_fantasia: 'Outro' },
        ],
      }),
      'teste',
      'rede',
      (m) => avisos.push(m),
    );
    await f.carregar();
    expect(f.estabelecimentos.map((e) => e.codigo)).toEqual(['hosp']);
    expect(avisos).toHaveLength(1);
  });

  it('banco fora do ar: a saúde mostra indisponível, sem derrubar a lista lida', async () => {
    let falhar = false;
    const n = nucleo({ estabelecimento: [{ id: 1, codigo: 'hosp', nome_fantasia: 'Hospital' }] });
    const f = new FonteAcessoPropria(
      {
        ...n,
        lerSomente: (c, fn) => (falhar ? Promise.reject(new Error('fora')) : n.lerSomente(c, fn)),
      },
      'teste',
      'rede',
    );
    await f.carregar();
    falhar = true;
    await f.carregar();
    expect(f.saude()).toEqual([
      expect.objectContaining({ codigo: 'hosp', disponivel: false, motivo: 'banco do cliente indisponível' }),
    ]);
  });

  it('sem cliente ou sem rede, a fonte não é criada', async () => {
    const n = nucleo({});
    await expect(criarFonteAcessoPropria(n, { REDE_PADRAO: 'rede' })).rejects.toThrow(/CLIENTE_PADRAO/);
    await expect(criarFonteAcessoPropria(n, { CLIENTE_PADRAO: 'teste' })).rejects.toThrow(/REDE_PADRAO/);
  });
});
