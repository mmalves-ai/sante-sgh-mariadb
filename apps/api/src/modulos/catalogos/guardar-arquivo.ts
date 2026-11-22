// Arquivo original da carga de catálogo (ficha do M13, seção 5): vai à porta de arquivos do núcleo (ADR 0004: disco
// local do cliente, gravação uma vez, guarda legal pela política do ambiente, a mesma dos documentos do M09) e fica
// ligado à carga (carga_catalogo.arquivo_guardado recebe o id do arquivo). A edição anterior, quando o banco não a
// guarda, continua recuperável pelo arquivo e pelas linhas da preparação. Sem o núcleo do banco próprio, a carga segue
// sem o arquivo guardado (a tela mostra "arquivo não guardado"). O arquivo leva o estabelecimento da carga (mapa código
// → id do cliente; fora dele, recusa) e a tabela dona (`carga_catalogo`, que guarda o id do arquivo).
import { randomUUID } from 'node:crypto';
import type { NucleoArmazem } from '@sgh/nucleo';
import type { Configuracao } from '../../configuracao.js';
import { politicaRetencao, retencaoAte } from '../documento/aplicacao/emissao.service.js';
import { armazemArquivosDoAmbiente, estabelecimentoDoCliente } from '../documento/public-api.js';

export function guardarArquivoCatalogo(
  cfg: Configuracao,
  env: NodeJS.ProcessEnv,
  nucleo: NucleoArmazem | null = null,
):
  ((hospital: string, sha256: string, nome: string, conteudo: string) => Promise<string | null>) | undefined {
  const cliente = cfg.clientePadrao;
  if (!nucleo || !cliente) return undefined;
  const armazem = armazemArquivosDoAmbiente({ nucleo, cliente, sintetico: false, env });
  const retencao = politicaRetencao(cfg.ambiente, env);
  const idEstabelecimento = estabelecimentoDoCliente(cliente, nucleo);
  return async (hospital, sha256, nome, conteudo) => {
    // Chave nova por gravação: o mesmo arquivo cai no mesmo registro pela porta (reaproveitado).
    const chaveIdempotencia = `catalogo-${randomUUID()}`;
    const estabelecimento = await idEstabelecimento(hospital);
    const g = await armazem.guardar(
      {
        conteudo: Buffer.from(conteudo, 'utf8'),
        nomeOriginal: (nome.trim() || `${hospital}-${sha256}.txt`).slice(0, 255),
        tipoMime: 'text/plain',
        finalidade: 'carga_catalogo',
        entidade: 'carga_catalogo',
        retencaoAte: retencaoAte(retencao),
        imutavel: retencao.imutavel,
      },
      { cliente, estabelecimento, usuario: null, correlacao: chaveIdempotencia, chaveIdempotencia },
    );
    return String(g.id);
  };
}
