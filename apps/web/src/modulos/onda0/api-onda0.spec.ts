// Onda 0 (M38) no cliente: as chaves de tela que fecham a tela, o resumo da vigilância, o erro de indisponibilidade
// (contingência, regra 7) e a leitura pelo contrato.
import { describe, expect, it, vi } from 'vitest';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { permissoesEfetivas, telaFechadaPelaChave } from '../../casca/sessao/sessao.js';
import { buscarVigia, chavesDeTelaDesligadas, lerTelasOnda0, resumoVigia } from './api-onda0.js';
import { foraDoEscopo, indisponivel } from './indisponivel.js';

const tela = (id: string, recurso: string | null, situacao: string) => ({
  id,
  recurso,
  permissao: 'x',
  situacao: situacao as 'ligada',
  escritaLiberada: null,
});
const execucao = (data: string, divergentes: number) => ({
  resultado: {
    hospital: 'pc',
    data,
    operacao: 'auditoria.registrarEventoLegado',
    amostradas: 50,
    divergentes,
    elementos: divergentes
      ? [
          {
            tipo: 'classe' as const,
            tabela: 'TBCABTRILHA',
            coluna: 'USUARIO',
            classe: 'entrada',
            ocorrencias: 1,
          },
        ]
      : [],
  },
  executadoEm: `${data}T06:00:00.000Z`,
});
const responder = (corpo: unknown, status = 200) =>
  vi.fn(
    async (...args: [string, RequestInit?]) =>
      new Response(JSON.stringify(args.length >= 0 ? corpo : null), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );

describe('onda 0 no cliente', () => {
  it('a chave de tela fora do escopo ou desligada tira a permissão da tela e fecha a rota', () => {
    const d = chavesDeTelaDesligadas([
      tela('pacientes', 'cadastro.paciente.consulta', 'fora-do-escopo'),
      tela('matriz', 'config.matriz.consulta', 'ligada'),
      tela('saude', 'sistema.saude.consulta', 'desligada'),
      tela('busca-global', null, 'sem-chave'),
    ]);
    expect([...d].sort()).toEqual(['cadastro.paciente.consulta', 'sistema.saude.consulta']);
    expect(chavesDeTelaDesligadas(undefined).size).toBe(0);
    const p = permissoesEfetivas(['cadastro.paciente.ler', 'config.matriz.ler', 'sistema.saude.ler'], {
      prontuario: false,
      telas: d,
    });
    expect([...p]).toEqual(['config.matriz.ler']);
    expect(telaFechadaPelaChave('cadastro.paciente.ler', d)).toBe(true);
    expect(telaFechadaPelaChave('config.matriz.ler', d)).toBe(false);
  });

  it('resumo da vigilância: dias com execução e com divergência', () => {
    expect(resumoVigia(undefined)).toEqual({ dias: 0, comDivergencia: 0 });
    const p = {
      hospital: 'pc',
      de: '2026-11-01',
      ate: '2026-11-07',
      estabelecimentos: ['pc'],
      execucoes: [execucao('2026-11-03', 0), execucao('2026-11-02', 1)],
    };
    expect(resumoVigia(p)).toEqual({ dias: 2, comDivergencia: 1 });
  });

  it('indisponível: rede fora, 502, 503 e 504; as demais respostas não', () => {
    expect(indisponivel(new TypeError('Failed to fetch'))).toBe(true);
    expect(indisponivel(new ErroApi(null, 503))).toBe(true);
    expect(indisponivel(new ErroApi(null, 504))).toBe(true);
    expect(indisponivel(new ErroApi(null, 403))).toBe(false);
    expect(indisponivel(new Error('x'))).toBe(false);
    const motivo = 'Esta consulta ainda não foi liberada para o seu perfil nesta etapa da implantação.';
    expect(foraDoEscopo(new ErroApi({ type: 'x', detail: motivo }, 403))).toBe(true);
    expect(foraDoEscopo(new ErroApi({ type: 'x', detail: 'outro' }, 403))).toBe(false);
    expect(foraDoEscopo(new ErroApi(null, 503))).toBe(false);
  });

  it('lê as telas e a vigilância pelo contrato; o filtro vai na consulta; erro vira ErroApi', async () => {
    const telas = responder({
      hospital: 'pc',
      telas: [tela('leitos', 'internacao.leitos.painel', 'ligada')],
    });
    expect((await lerTelasOnda0(telas as unknown as typeof fetch)).telas).toHaveLength(1);
    const v = responder({
      hospital: 'pc',
      de: '2026-11-01',
      ate: '2026-11-07',
      estabelecimentos: ['pc'],
      execucoes: [],
    });
    await buscarVigia({ hospital: 'pc', de: '2026-11-01' }, v as unknown as typeof fetch);
    expect(v.mock.calls[0]?.[0]).toBe('/api/config/assinaturas/vigia?hospital=pc&de=2026-11-01');
    await buscarVigia({}, v as unknown as typeof fetch);
    expect(v.mock.calls[1]?.[0]).toBe('/api/config/assinaturas/vigia');
    await expect(lerTelasOnda0(responder({}, 503) as unknown as typeof fetch)).rejects.toBeInstanceOf(
      ErroApi,
    );
    await expect(buscarVigia({}, responder({}, 403) as unknown as typeof fetch)).rejects.toBeInstanceOf(
      ErroApi,
    );
  });
});
