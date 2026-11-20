<script setup lang="ts">
// "Parceiros externos" > "Credenciais guardadas no banco" (M59-F3; ficha do M59, seção 5 e regras 1 e 7; cap-08
// §8.11). A situação por tipo de credencial (contagens em faixa) e por registro: quais senhas ainda estão no banco,
// quais já têm a credencial do Sante no cofre, se foi trocada com o parceiro e se a antiga já saiu. O gestor guarda no
// cofre a credencial que o Sante passa a usar (o valor só vai na ida) e, terminada a contingência, retira a antiga
// (todas as senhas do registro juntas, pelo executor). As duas ações pedem a senha de novo. O valor nunca aparece.
import { type LinhaSegredoLegado, PERMISSOES_M59_CODIGOS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import {
  buscarSegredosParceiros,
  guardarSegredoNoCofre,
  retirarSegredoAntigo,
} from '../../acesso/api-segredos.js';
import {
  colunasDaTabela,
  colunasSemCofre,
  dataHoraBr,
  fmtContagem,
  identificacaoDaLinha,
  podeGuardarNaLinha,
  podeRetirarLinha,
  type SituacaoLinhaSegredo,
  situacaoDaLinha,
} from '../../acesso/segredos-tela.js';

const P = 'segredos.parceiros';
const { t, te } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['segredos-parceiros'], queryFn: () => buscarSegredosParceiros() });
const dados = computed(() => consulta.data.value);
const gere = computed(() => pode(PERMISSOES_M59_CODIGOS.segredoLegadoGerir));

const rotuloTabela = (tabela: string): string =>
  dados.value?.tabelas.find((x) => x.tabela === tabela)?.rotulo ?? '';
const rotuloColuna = (tabela: string, coluna: string): string => {
  const k = `segredos.colunas.${tabela}.${coluna}`;
  return te(k) ? t(k) : coluna;
};
const listaColunas = (tabela: string, colunas: readonly string[]): string =>
  colunas.length ? colunas.map((c) => rotuloColuna(tabela, c)).join(', ') : t(`${P}.nenhumaColuna`);
const rotuloExcecao = (objeto: string): string => {
  const k = `segredos.excecoes.${objeto}`;
  return te(k) ? t(k) : objeto;
};
// O motivo do contrato é técnico (verificador e trilha); a tela mostra o de produto. Sem texto: nada técnico aparece.
const motivoExcecao = (objeto: string): string => {
  const k = `segredos.excecoesMotivo.${objeto}`;
  return te(k) ? t(k) : '';
};

// ── filtros (no cliente: a lista vem inteira, até o teto do servidor) ──────────────────────────
const tipo = ref('');
const situacao = ref<'' | SituacaoLinhaSegredo>('');
const busca = ref('');
const opcoesTipo = computed(() => [
  { valor: '', rotulo: t(`${P}.todos`) },
  ...(dados.value?.tabelas ?? []).map((x) => ({ valor: x.tabela, rotulo: x.rotulo })),
]);
const SITUACOES: SituacaoLinhaSegredo[] = ['falta-cofre', 'bloqueado', 'pronto', 'retirado'];
const opcoesSituacao = computed(() => [
  { valor: '' as const, rotulo: t(`${P}.todas`) },
  ...SITUACOES.map((s) => ({ valor: s, rotulo: t(`segredos.situacoes.${s}`) })),
]);
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const linhas = computed(() => {
  const palavras = normalizar(busca.value).split(/\s+/).filter(Boolean);
  return (dados.value?.linhas ?? []).filter((l) => {
    if (tipo.value && l.tabela !== tipo.value) return false;
    if (situacao.value && situacaoDaLinha(l) !== situacao.value) return false;
    const alvo = normalizar(`${identificacaoDaLinha(l)} ${rotuloTabela(l.tabela)}`);
    return palavras.every((p) => alvo.includes(p));
  });
});
function textoSituacao(l: LinhaSegredoLegado): string {
  const s = situacaoDaLinha(l);
  if (s === 'retirado') return t(`${P}.retiradoEm`, { em: dataHoraBr(l.retiradoEm) });
  if (s === 'bloqueado' && l.bloqueio) return t(`segredos.bloqueios.${l.bloqueio}`);
  return t(`segredos.situacoes.${s}`);
}
const chaveLinha = (l: LinhaSegredoLegado) => `${l.tabela}|${l.chave}`;
const testidLinha = (l: LinhaSegredoLegado) =>
  `${l.tabela}-${l.chave.replace(/[^A-Za-z0-9]+/g, '-')}`.toLowerCase();

// ── ações com a senha de novo ──────────────────────────────────────────────────────────────────
type Acao = { tipo: 'guardar' | 'retirar'; linha: LinhaSegredoLegado };
const acao = ref<Acao | null>(null);
const coluna = ref('');
const valor = ref('');
const rotacionado = ref<'sim' | 'nao'>('sim');
const senha = ref('');
const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);
const idValor = `segredo-valor-${useId()}`;
const dialogo = computed({
  get: () => acao.value !== null,
  set: (v: boolean) => {
    if (!v) fechar();
  },
});
const opcoesColuna = computed(() => {
  const a = acao.value;
  if (!a) return [];
  return colunasDaTabela(a.linha.tabela).map((c) => ({ valor: c, rotulo: rotuloColuna(a.linha.tabela, c) }));
});
const opcoesRotacao = computed(() => [
  { valor: 'sim' as const, rotulo: t(`${P}.rotacionadoSim`) },
  { valor: 'nao' as const, rotulo: t(`${P}.rotacionadoNao`) },
]);
function fechar(): void {
  acao.value = null;
  valor.value = '';
  senha.value = '';
}
function abrir(tipoAcao: Acao['tipo'], linha: LinhaSegredoLegado): void {
  acao.value = { tipo: tipoAcao, linha };
  coluna.value = colunasSemCofre(linha)[0] ?? colunasDaTabela(linha.tabela)[0] ?? '';
  valor.value = '';
  rotacionado.value = 'sim';
  senha.value = '';
  erro.value = null;
}
async function confirmar(): Promise<void> {
  const a = acao.value;
  if (!a || ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  const registro = identificacaoDaLinha(a.linha);
  try {
    if (a.tipo === 'guardar')
      await guardarSegredoNoCofre({
        tabela: a.linha.tabela,
        chave: a.linha.chave,
        coluna: coluna.value,
        valor: valor.value,
        rotacionado: rotacionado.value === 'sim',
        senha: senha.value,
      });
    else await retirarSegredoAntigo(a.linha.tabela, a.linha.chave, senha.value);
    aviso.value = t(a.tipo === 'guardar' ? `${P}.guardado` : `${P}.retirado`, { registro });
    fechar();
    await cliente.invalidateQueries({ queryKey: ['segredos-parceiros'] });
  } catch (e) {
    erro.value = e;
    senha.value = '';
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <div class="segredos" data-testid="segredos-parceiros">
    <h2>{{ t(`${P}.titulo`) }}</h2>
    <p>{{ t(`${P}.texto`) }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="segredos-aviso" />

    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('segredos.comum.carregando') }}</p>
    <template v-else-if="dados">
      <SanteAlerta
        :texto="
          dados.contingenciaLigada
            ? t('segredos.comum.contingenciaLigada')
            : t('segredos.comum.contingenciaDesligada')
        "
        :variante="dados.contingenciaLigada ? 'aviso' : 'info'"
        data-testid="segredos-contingencia"
      />
      <SanteAlerta
        v-if="!dados.cofreDisponivel"
        :texto="t(`${P}.cofreIndisponivel`)"
        variante="aviso"
        data-testid="segredos-sem-cofre"
      />
      <SanteAlerta
        v-if="!dados.receita.ligada"
        :texto="
          dados.receita.motivo
            ? t('segredos.comum.receitaDesligada', { motivo: dados.receita.motivo })
            : t('segredos.comum.receitaDesligadaSemMotivo')
        "
        variante="info"
        data-testid="segredos-desligada"
      />

      <section class="bloco" :aria-label="t(`${P}.resumo`)" data-testid="segredos-resumo">
        <h3>{{ t(`${P}.resumo`) }}</h3>
        <div class="rolagem" tabindex="0" role="region" :aria-label="t(`${P}.resumo`)">
          <table>
            <caption>
              {{
                t(`${P}.resumo`)
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t(`${P}.colunasResumo.tipo`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.colunasResumo.comValor`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.colunasResumo.noCofre`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.colunasResumo.rotacionados`) }}</th>
                <th scope="col" class="num">{{ t(`${P}.colunasResumo.retirados`) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in dados.tabelas" :key="x.tabela" :data-testid="`segredos-resumo-${x.tabela}`">
                <th scope="row">{{ x.rotulo }}</th>
                <td class="num">{{ fmtContagem(x.comValor) }}</td>
                <td class="num">{{ fmtContagem(x.noCofre) }}</td>
                <td class="num">{{ fmtContagem(x.rotacionados) }}</td>
                <td class="num">{{ fmtContagem(x.retirados) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <form class="filtros" role="search" @submit.prevent>
        <div class="campo">
          <label for="segredos-busca">{{ t(`${P}.busca`) }}</label>
          <input
            id="segredos-busca"
            v-model="busca"
            type="search"
            maxlength="60"
            data-testid="segredos-busca"
          />
        </div>
        <div class="campo">
          <SanteSelecao
            v-model="tipo"
            :rotulo="t(`${P}.filtroTipo`)"
            :opcoes="opcoesTipo"
            data-testid="segredos-filtro-tipo"
          />
        </div>
        <div class="campo">
          <SanteSelecao
            v-model="situacao"
            :rotulo="t(`${P}.filtroSituacao`)"
            :opcoes="opcoesSituacao"
            data-testid="segredos-filtro-situacao"
          />
        </div>
      </form>

      <p v-if="dados.linhas.length < dados.linhasTotal" class="discreto" data-testid="segredos-mostrando">
        {{ t(`${P}.mostrando`, { n: dados.linhas.length, total: dados.linhasTotal }) }}
      </p>
      <p v-if="linhas.length === 0" role="status" data-testid="segredos-vazia">{{ t(`${P}.nenhuma`) }}</p>
      <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t(`${P}.rolagem`)">
        <table data-testid="tabela-segredos">
          <caption>
            {{
              t(`${P}.legenda`)
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t(`${P}.colunasLinha.tipo`) }}</th>
              <th scope="col">{{ t(`${P}.colunasLinha.registro`) }}</th>
              <th scope="col">{{ t(`${P}.colunasLinha.comValor`) }}</th>
              <th scope="col">{{ t(`${P}.colunasLinha.noCofre`) }}</th>
              <th scope="col">{{ t(`${P}.colunasLinha.situacao`) }}</th>
              <th v-if="gere" scope="col">{{ t(`${P}.colunasLinha.acoes`) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in linhas" :key="chaveLinha(l)" :data-testid="`segredos-linha-${testidLinha(l)}`">
              <td>{{ rotuloTabela(l.tabela) }}</td>
              <th scope="row">{{ identificacaoDaLinha(l) }}</th>
              <td>{{ listaColunas(l.tabela, l.comValor) }}</td>
              <td>
                {{ listaColunas(l.tabela, l.noCofre) }}
                <span v-if="l.rotacionadoEm" class="discreto">
                  · {{ t(`${P}.rotacionadoEm`, { em: dataHoraBr(l.rotacionadoEm) }) }}</span
                >
              </td>
              <td :data-testid="`segredos-situacao-${testidLinha(l)}`">{{ textoSituacao(l) }}</td>
              <td v-if="gere" class="acoes">
                <SanteBotao
                  v-if="podeGuardarNaLinha(l, gere) && dados.cofreDisponivel"
                  :rotulo="t(`${P}.guardar`)"
                  variante="texto"
                  :data-testid="`segredos-guardar-${testidLinha(l)}`"
                  @acionar="abrir('guardar', l)"
                />
                <SanteBotao
                  v-if="podeRetirarLinha(l, gere)"
                  :rotulo="t(`${P}.retirar`)"
                  variante="texto"
                  :data-testid="`segredos-retirar-${testidLinha(l)}`"
                  @acionar="abrir('retirar', l)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="dados.excecoes.length" class="bloco" data-testid="segredos-excecoes">
        <h3>{{ t(`${P}.excecoes`) }}</h3>
        <dl>
          <template v-for="e in dados.excecoes" :key="e.objeto">
            <dt>{{ rotuloExcecao(e.objeto) }}</dt>
            <dd>{{ motivoExcecao(e.objeto) }}</dd>
          </template>
        </dl>
      </section>
    </template>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="
        acao
          ? t(acao.tipo === 'guardar' ? `${P}.guardarDe` : `${P}.retirarDe`, {
              registro: identificacaoDaLinha(acao.linha),
            })
          : ''
      "
    >
      <form v-if="acao" class="form" data-testid="form-segredo" @submit.prevent="confirmar">
        <template v-if="acao.tipo === 'guardar'">
          <SanteSelecao
            v-model="coluna"
            :rotulo="t(`${P}.campoColuna`)"
            :opcoes="opcoesColuna"
            data-testid="segredo-coluna"
          />
          <div class="campo">
            <label :for="idValor">{{ t(`${P}.campoValor`) }}</label>
            <input
              :id="idValor"
              v-model="valor"
              type="password"
              autocomplete="new-password"
              maxlength="200"
              required
              :aria-describedby="`${idValor}-ajuda`"
              data-testid="segredo-valor"
            />
            <small :id="`${idValor}-ajuda`">{{ t(`${P}.campoValorAjuda`) }}</small>
          </div>
          <SanteOpcoes
            v-model="rotacionado"
            :legenda="t(`${P}.rotacionado`)"
            :opcoes="opcoesRotacao"
            nome="segredo-rotacionado"
            data-testid="segredo-rotacionado"
          />
        </template>
        <p v-else>
          {{ t(`${P}.retirarTexto`, { colunas: listaColunas(acao.linha.tabela, acao.linha.comValor) }) }}
        </p>
        <MensagemErro v-if="erro" :erro="erro" />
        <SenhaConfirmacao v-model="senha" testid="segredo-senha" />
        <div class="botoes">
          <SanteBotao
            :rotulo="t('segredos.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="segredo-confirmar"
          />
          <SanteBotao :rotulo="t('segredos.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
        </div>
      </form>
    </SanteDialogo>
  </div>
</template>

<style scoped>
.bloco {
  margin: var(--sgh-espaco-3) 0;
}
.bloco dl {
  margin: 0;
}
.bloco dt {
  font-weight: 600;
}
.bloco dd {
  margin: 0 0 var(--sgh-espaco-2);
}
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  margin: var(--sgh-espaco-2) 0;
}
.campo,
.form {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.form {
  gap: var(--sgh-espaco-2);
}
.botoes,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.discreto {
  color: var(--sgh-texto-secundario);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.num {
  text-align: right;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
