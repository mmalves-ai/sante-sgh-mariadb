// Porta da rouparia (M55, fatia F2) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de @sgh/legado; as
// gravações só do novo numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_). Recurso só do novo: o
// executor não é usado (nenhuma operação do legado). Em dev sobre a cópia compartilhada, as gravações SGH_ recusam
// (`sghSoLeitura`), como nos outros módulos. `portaRoupariaNaTransacao`: a mesma porta sobre UMA transação aberta (os
// testes de integração na cópia, desfeita).
import {
  alterarPecaRoupaSgh,
  cancelarMovimentoRoupaSgh,
  centrosDeCusto,
  cotasRoupa,
  enviosAbertosRoupa,
  type Escritor,
  fornecedoresEstoque,
  fornecedorExiste,
  gravarCotasRoupaSgh,
  gravarTrilha,
  incluirPecaRoupaSgh,
  inventariosRoupa,
  kgColetadosPorSetorDia,
  type Leitor,
  movimentoRoupa,
  movimentoRoupaPelaChave,
  movimentosRoupa,
  type NucleoLegado,
  pacientesDiaDoCenso,
  pecasRoupa,
  registrarMovimentoRoupaSgh,
  relogioRouparia,
  somenteSgh,
  totaisRouparia,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type GravadorRouparia, METODOS_PORTA_ROUPARIA, type PortaRouparia } from './porta.js';

const SEM_EXECUTOR = 'A rouparia não usa operação do executor: tudo é gravado só no novo.';

function gravador(e: Escritor, hospital: string): GravadorRouparia {
  return {
    relogio: () => relogioRouparia(e),
    pecas: () => pecasRoupa(e, hospital),
    movimento: (id) => movimentoRoupa(e, hospital, id, { travar: true }),
    movimentoPelaChave: (chave) => movimentoRoupaPelaChave(e, hospital, chave),
    incluirPeca: (p) => incluirPecaRoupaSgh(e, { hospital, ...p }),
    alterarPeca: (p) => alterarPecaRoupaSgh(e, { hospital, ...p }),
    gravarCotas: (c) => gravarCotasRoupaSgh(e, { hospital, ...c }),
    registrarMovimento: (m) => registrarMovimentoRoupaSgh(e, { hospital, ...m }),
    cancelarMovimento: (c) => cancelarMovimentoRoupaSgh(e, { hospital, ...c }),
  };
}

type Ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaRouparia, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) => ler(c, (l) => relogioRouparia(l)),
    pecas: (c) => ler(c, (l) => pecasRoupa(l, c.hospital)),
    cotas: (c, centro) => ler(c, (l) => cotasRoupa(l, c.hospital, centro ?? null)),
    movimentos: (c, f) => ler(c, (l) => movimentosRoupa(l, c.hospital, f)),
    movimento: (c, id) => ler(c, (l) => movimentoRoupa(l, c.hospital, id)),
    enviosAbertos: (c) => ler(c, (l) => enviosAbertosRoupa(l, c.hospital)),
    kgPorSetorDia: (c, de, ate) => ler(c, (l) => kgColetadosPorSetorDia(l, c.hospital, de, ate)),
    totais: (c, de, ate) => ler(c, (l) => totaisRouparia(l, c.hospital, de, ate)),
    inventarios: (c, ate) => ler(c, (l) => inventariosRoupa(l, c.hospital, ate)),
    setores: (c) =>
      ler(c, async (l) =>
        (await centrosDeCusto(l)).map((x) => ({ codigo: x.codigo, nome: x.nome, ativo: x.ativo })),
      ),
    fornecedores: (c, termo) =>
      ler(c, async (l) =>
        (await fornecedoresEstoque(l, termo)).itens.map((f) => ({
          codigo: f.codigo,
          nome: f.fantasia || f.nome,
        })),
      ),
    fornecedorExiste: (c, codigo) => ler(c, (l) => fornecedorExiste(l, codigo)),
    pacientesDia: (c, de, ate) =>
      ler(c, async (l) =>
        (await pacientesDiaDoCenso(l, c.hospital, de, ate)).porSetor.reduce((s, x) => s + x.pacientesDia, 0),
      ),
  };
}

const semExecutor = {
  podeGravar: () => Promise.resolve({ pode: false, codigo: 'sem-operacao', motivo: SEM_EXECUTOR }),
  executar: (): Promise<never> => Promise.reject(new Error(SEM_EXECUTOR)),
};

export function portaRoupariaLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaRouparia {
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'rouparia' });
  return {
    destino: 'legado',
    ...semExecutor,
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: nada é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn(gravador(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaRoupariaNaTransacao(e: Escritor): PortaRouparia {
  return {
    destino: 'legado',
    ...semExecutor,
    async gravarSgh(c, trilha, fn) {
      const r = await fn(gravador(e, c.hospital));
      await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e as unknown as Leitor)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaRoupariaIndisponivel(): PortaRouparia {
  return portaIndisponivel<PortaRouparia>(METODOS_PORTA_ROUPARIA);
}
