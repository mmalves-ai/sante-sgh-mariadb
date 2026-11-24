<script setup lang="ts">
// A prescrição assinada (M24; ficha, seção 7): itens com os horários previstos e a situação de cada horário, a prova
// de gravação, os alertas decididos na assinatura; adendo (incluir item), suspensão do item ou da prescrição (com
// justificativa e senha), correção (suspende e inclui o corrigido), coassinatura do preceptor, renovar, copiar e
// imprimir. Horário já checado não muda: a suspensão fica pendente para a enfermagem.
import {
  type CategoriaPrescritor,
  GRUPO_DO_TIPO,
  type GrupoItemPrescricao,
  type ItemLido,
  type ItemPrescricao,
  SE_NECESSARIO_ADENDO,
  TIPOS_ADENDO,
  TIPOS_CORRECAO,
  TIPOS_ITEM_PRESCRICAO,
  type TipoItemPrescricao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  abrirPdf,
  coassinar,
  imprimirPrescricao,
  incluirItem,
  lerContexto,
  lerDominiosPrescricao,
  lerPrescricao,
  novaChave,
  suspenderItem,
  suspenderPrescricao,
} from '../api-prescricao.js';
import CabecalhoProntuario from '../componentes/CabecalhoProntuario.vue';
import ItemEditor from '../componentes/prescricao/ItemEditor.vue';
import ReceitaAlta from '../componentes/prescricao/ReceitaAlta.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { useConexao } from '../conexao.js';
import { agoraLocal } from '../descricao-item.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string; id: string }>();
const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const cliente = useQueryClient();
const online = useConexao();
const paciente = computed(() => Number(props.paciente));
const pid = computed(() => Number(props.id));
const chaveQ = computed(() => ['presc', 'ver', paciente.value, pid.value]);
const presc = useQuery({
  queryKey: chaveQ,
  queryFn: () => lerPrescricao(paciente.value, pid.value),
  staleTime: 0,
});
const contexto = useQuery({
  queryKey: computed(() => ['presc', 'contexto', paciente.value]),
  queryFn: () => lerContexto(paciente.value),
});
const dominios = useQuery({
  queryKey: ['presc', 'dominios'],
  queryFn: () => lerDominiosPrescricao(),
  staleTime: 300_000,
});
const p = computed(() => presc.data.value);
const c = computed(() => contexto.data.value);
const categoria = computed<CategoriaPrescritor>(
  () => (c.value?.prescritor?.categoria ?? 'outro') as CategoriaPrescritor,
);
const assinada = computed(() => {
  const a = typeof rota.query['assinada'] === 'string' ? rota.query['assinada'].split('.') : null;
  return a ? t('pep.presc.editor.assinada', { itens: a[0], horarios: a[1] }) : '';
});
const vigente = computed(() => p.value?.situacao === 'vigente' || p.value?.situacao === 'futura');
const podeAgir = computed(() => online.value && !!c.value?.liberacao.ligada && !!c.value?.prescritor);

// ── Diálogos ──────────────────────────────────────────────────────────────────────────────────────
type Acao = 'suspenderItem' | 'corrigir' | 'suspender' | 'coassinar' | 'incluir';
const dialogo = ref<Acao | null>(null);
const visivel = computed({
  get: () => dialogo.value !== null,
  set: (v: boolean) => {
    if (!v) dialogo.value = null;
  },
});
const alvo = ref<ItemLido | null>(null);
const justificativa = ref('');
const senha = ref('');
const correcao = ref<ItemPrescricao | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref('');
const ocupado = ref(false);
let chave = novaChave('suspensao');

function abrir(a: Acao, item: ItemLido | null = null): void {
  dialogo.value = a;
  alvo.value = item;
  justificativa.value = '';
  senha.value = '';
  correcao.value = null;
  erro.value = null;
  chave = novaChave(a);
}
const grupoDoAlvo = computed<GrupoItemPrescricao>(() => {
  const tipo = alvo.value?.tipo;
  return tipo && (TIPOS_ITEM_PRESCRICAO as readonly string[]).includes(tipo)
    ? GRUPO_DO_TIPO[tipo as TipoItemPrescricao]
    : 'medicamentos';
});
const grupoIncluir = ref<GrupoItemPrescricao>('medicamentos');
/** POL-3: o adendo só oferece os grupos dos tipos que a gravação cobre. */
const GRUPOS_ADENDO = [...new Set(TIPOS_ADENDO.map((x) => GRUPO_DO_TIPO[x]))];

async function confirmar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    if (dialogo.value === 'suspenderItem' && alvo.value) {
      const r = await suspenderItem(
        paciente.value,
        pid.value,
        alvo.value.id,
        { senha: senha.value, justificativa: justificativa.value },
        chave,
      );
      mensagem.value = t('pep.presc.ver.suspensoOk', { n: r.horarios });
    } else if (dialogo.value === 'corrigir' && alvo.value && correcao.value) {
      const r = await suspenderItem(
        paciente.value,
        pid.value,
        alvo.value.id,
        { senha: senha.value, justificativa: justificativa.value, correcao: correcao.value },
        chave,
      );
      mensagem.value = t('pep.presc.ver.suspensoOk', { n: r.horarios });
    } else if (dialogo.value === 'suspender') {
      const r = await suspenderPrescricao(
        paciente.value,
        pid.value,
        { senha: senha.value, justificativa: justificativa.value },
        chave,
      );
      mensagem.value = t('pep.presc.ver.suspensoOk', { n: r.horarios });
    } else if (dialogo.value === 'coassinar') {
      await coassinar(paciente.value, pid.value, senha.value);
      mensagem.value = t('pep.presc.ver.coassinadaOk');
    } else if (dialogo.value === 'incluir' && correcao.value) {
      await incluirItem(paciente.value, pid.value, { dataHora: agoraLocal(), item: correcao.value }, chave);
      mensagem.value = t('pep.presc.ver.incluidoOk');
    }
    dialogo.value = null;
    await cliente.invalidateQueries({ queryKey: chaveQ.value });
  } catch (e) {
    erro.value = e;
    chave = novaChave(dialogo.value ?? 'acao');
  } finally {
    ocupado.value = false;
  }
}
const pedeJustificativa = computed(
  () => dialogo.value === 'suspenderItem' || dialogo.value === 'corrigir' || dialogo.value === 'suspender',
);
const pedeSenha = computed(() => dialogo.value !== 'incluir');
const pedeItem = computed(() => dialogo.value === 'corrigir' || dialogo.value === 'incluir');
const prontoParaConfirmar = computed(
  () =>
    online.value &&
    (!pedeJustificativa.value || justificativa.value.trim().length >= 10) &&
    (!pedeSenha.value || senha.value.length > 0) &&
    (!pedeItem.value || correcao.value !== null),
);
const tituloDialogo = computed(() =>
  dialogo.value === 'suspenderItem'
    ? t('pep.presc.ver.dialogoSuspenderItem')
    : dialogo.value === 'corrigir'
      ? t('pep.presc.ver.dialogoCorrigir')
      : dialogo.value === 'suspender'
        ? t('pep.presc.ver.dialogoSuspender')
        : dialogo.value === 'coassinar'
          ? t('pep.presc.ver.dialogoCoassinar')
          : t('pep.presc.ver.dialogoIncluir'),
);
function renovar(modo: 'renovacao' | 'copia'): void {
  if (!p.value) return;
  void roteador.push({
    path: `/pep/paciente/${paciente.value}/prescricao/nova`,
    query: {
      atendimento: String(p.value.atendimento),
      origem: String(p.value.id),
      modo,
      ...(modo === 'renovacao' ? { periodo: 'seguinte' } : {}),
    },
  });
}
// Impressão: o PDF/A do serviço de emissão (01-ADM L82: a 1ª via leva a justificativa; a reimpressão é a 2ª via,
// com o motivo); sem o serviço, a impressão da
// própria tela (com os horários previstos).
const impressoes = ref(0);
const motivoVia = ref('');
const erroImpressao = ref<unknown>(null);
async function imprimir(): Promise<void> {
  erroImpressao.value = null;
  try {
    abrirPdf(await imprimirPrescricao(paciente.value, pid.value, motivoVia.value.trim() || null));
    impressoes.value++;
    motivoVia.value = '';
  } catch (e) {
    if (e instanceof ErroApi && e.status === 503) window.print();
    else erroImpressao.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="presc-ver-titulo" data-testid="tela-prescricao-ver">
    <MensagemErro v-if="presc.isError.value" :erro="presc.error.value" />
    <p v-else-if="!p" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else>
      <h1 id="presc-ver-titulo">{{ t('pep.presc.ver.titulo', { data: dataHoraBr(p.dataHora) }) }}</h1>
      <p class="nao-imprimir">
        <RouterLink :to="`/pep/paciente/${paciente}/prescricao`">{{ t('pep.presc.voltar') }}</RouterLink>
      </p>
      <SanteAlerta v-if="!online" variante="alerta" :texto="t('pep.presc.semConexao')" anunciar />
      <CabecalhoProntuario v-if="c" :cabecalho="c.cabecalho" />
      <SanteAlerta
        v-if="assinada"
        variante="info"
        :texto="assinada"
        anunciar
        data-testid="prescricao-assinada"
      />
      <SanteAlerta
        v-if="mensagem"
        variante="info"
        :texto="mensagem"
        anunciar
        data-testid="mensagem-prescricao"
      />
      <p data-testid="situacao-prescricao">
        <strong>{{ t(`pep.presc.situacoes.${p.situacao}`) }}</strong> ·
        {{
          t('pep.presc.ver.vigencia', {
            inicio: dataHoraBr(p.vigencia.inicio),
            fim: dataHoraBr(p.vigencia.fim),
          })
        }}
        ·
        {{ t('pep.presc.ver.prescritor', { nome: p.prescritor }) }}
      </p>
      <p data-testid="prova-prescricao" :class="['prova', p.prova]">
        {{ t(`pep.presc.ver.prova.${p.prova}`) }}
      </p>
      <SanteAlerta
        v-if="p.coassinaturaPendente"
        variante="aviso"
        :texto="t('pep.presc.paciente.coassinaturaPendente')"
      />
      <SanteAlerta
        v-if="p.suspensao"
        variante="aviso"
        :texto="
          t('pep.presc.ver.suspensa', {
            por: p.suspensao.por,
            em: dataHoraBr(p.suspensao.em),
            justificativa: p.suspensao.justificativa,
          })
        "
        data-testid="prescricao-suspensa"
      />

      <div class="acoes nao-imprimir">
        <SanteBotao
          v-if="podeAgir && vigente && c?.podeCriar"
          :rotulo="t('pep.presc.ver.incluir')"
          variante="secundario"
          data-testid="incluir-adendo"
          @acionar="abrir('incluir')"
        />
        <SanteBotao
          v-if="podeAgir && vigente && c?.podeSuspender"
          :rotulo="t('pep.presc.ver.suspender')"
          variante="secundario"
          data-testid="suspender-prescricao"
          @acionar="abrir('suspender')"
        />
        <SanteBotao
          v-if="
            podeAgir && p.coassinaturaPendente && c?.podeCoassinar && c.prescritor?.categoria === 'medico'
          "
          :rotulo="t('pep.presc.ver.coassinar')"
          data-testid="coassinar"
          @acionar="abrir('coassinar')"
        />
        <SanteBotao
          v-if="podeAgir && c?.podeRenovar && p.situacao !== 'suspensa'"
          :rotulo="t('pep.presc.ver.renovar')"
          variante="secundario"
          data-testid="renovar"
          @acionar="renovar('renovacao')"
        />
        <SanteBotao
          v-if="podeAgir && c?.podeRenovar"
          :rotulo="t('pep.presc.ver.copiar')"
          variante="texto"
          @acionar="renovar('copia')"
        />
        <form class="imprimir" data-testid="imprimir-prescricao" @submit.prevent="imprimir">
          <SanteCampoTexto
            v-model="motivoVia"
            :rotulo="
              impressoes > 0 ? t('pep.presc.ver.segundaVia') : t('pep.presc.ver.justificativaImpressao')
            "
            :max-bytes="200"
            obrigatorio
          />
          <SanteBotao tipo="submit" :rotulo="t('pep.presc.ver.imprimir')" variante="texto" />
        </form>
      </div>
      <MensagemErro v-if="erroImpressao" :erro="erroImpressao" />

      <table data-testid="itens-lidos">
        <caption>
          {{
            t('pep.presc.ver.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pep.presc.ver.itens') }}</th>
            <th scope="col">{{ t('pep.presc.paciente.colunas.situacao') }}</th>
            <th scope="col">{{ t('pep.presc.ver.horarios') }}</th>
            <th scope="col" class="nao-imprimir">{{ t('pep.presc.paciente.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in p.itensLidos" :key="i.id" :data-testid="`item-lido-${i.id}`" :class="i.situacao">
            <td>
              <strong>{{ i.tipoNome }}</strong> {{ i.descricao }}
              <span v-if="i.dose"> · {{ i.dose }}</span>
              <span v-if="i.via"> · {{ i.via }}</span>
              <span v-if="i.frequencia"> · {{ i.frequencia }}</span>
              <span v-if="i.incluidoDepois" class="marca">{{ t('pep.presc.ver.incluidoDepois') }}</span>
              <span v-if="i.corrigidoPor" class="marca">{{
                t('pep.presc.ver.corrigidoPor', { id: i.corrigidoPor })
              }}</span>
              <p v-if="i.observacaoEnfermagem" class="obs">{{ i.observacaoEnfermagem }}</p>
            </td>
            <td :data-testid="`situacao-item-${i.id}`">{{ t(`pep.presc.situacoes.${i.situacao}`) }}</td>
            <td>
              <ul class="horas">
                <li v-for="h in i.horarios" :key="h.id">
                  <time :datetime="h.dataHora">{{ dataHoraBr(h.dataHora).slice(-5) }}</time>
                  <span class="secundario">{{ h.rotulo }}</span>
                </li>
              </ul>
            </td>
            <td class="nao-imprimir">
              <template v-if="podeAgir && vigente && c?.podeSuspender && i.situacao === 'ativo'">
                <SanteBotao
                  :rotulo="t('pep.presc.ver.suspenderItem', { item: i.descricao })"
                  variante="texto"
                  :data-testid="`suspender-item-${i.id}`"
                  @acionar="abrir('suspenderItem', i)"
                />
                <SanteBotao
                  v-if="c?.podeCriar && (TIPOS_CORRECAO as readonly string[]).includes(i.tipo)"
                  :rotulo="t('pep.presc.ver.corrigirItem', { item: i.descricao })"
                  variante="texto"
                  :data-testid="`corrigir-item-${i.id}`"
                  @acionar="abrir('corrigir', i)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <!-- Regra 15: na alta, os medicamentos viram as receitas do receituário do prontuário. -->
      <ReceitaAlta v-if="pode('pep.receita.emitir')" :paciente="paciente" :prescricao="pid" />
      <section v-if="p.alertasDecididos.length" data-testid="alertas-decididos">
        <h2>{{ t('pep.presc.ver.alertasDecididos') }}</h2>
        <ul>
          <li v-for="(a, k) in p.alertasDecididos" :key="k">
            {{ t(`pep.presc.farmacia.tiposAlerta.${a.tipo}`) }} · {{ a.decisao
            }}<span v-if="a.justificativa">: {{ a.justificativa }}</span>
          </li>
        </ul>
      </section>

      <SanteDialogo v-model:visivel="visivel" :titulo="tituloDialogo" largura="48rem">
        <form class="dialogo" data-testid="dialogo-prescricao" @submit.prevent="confirmar">
          <p v-if="alvo">{{ alvo.tipoNome }}: {{ alvo.descricao }}</p>
          <p v-if="dialogo === 'suspenderItem' || dialogo === 'suspender'" class="secundario">
            {{ t('pep.presc.ver.pendenciaChecado') }}
          </p>
          <template v-if="pedeItem && dominios.data.value">
            <div
              v-if="dialogo === 'incluir'"
              role="tablist"
              class="abas"
              :aria-label="t('pep.presc.editor.abas')"
            >
              <button
                v-for="g in GRUPOS_ADENDO"
                :key="g"
                type="button"
                role="tab"
                :aria-selected="grupoIncluir === g"
                @click="grupoIncluir = g"
              >
                {{ t(`pep.presc.grupos.${g}`) }}
              </button>
            </div>
            <p v-if="correcao" role="status" data-testid="item-pronto">
              {{ t(`pep.presc.tipos.${correcao.detalhe.tipo}`) }}
            </p>
            <ItemEditor
              v-else
              :key="dialogo === 'incluir' ? grupoIncluir : grupoDoAlvo"
              prefixo="dialogo"
              :grupo="dialogo === 'incluir' ? grupoIncluir : grupoDoAlvo"
              :dominios="dominios.data.value"
              :categoria="categoria"
              :dados="c?.dadosClinicos ?? null"
              :tipos="dialogo === 'incluir' ? TIPOS_ADENDO : TIPOS_CORRECAO"
              :se-necessario-em="dialogo === 'incluir' ? SE_NECESSARIO_ADENDO : []"
              @incluir="(i: ItemPrescricao) => (correcao = i)"
            />
          </template>
          <div v-if="pedeJustificativa" class="campo">
            <label for="presc-just">{{ t('pep.presc.ver.justificativa') }}</label>
            <textarea
              id="presc-just"
              v-model="justificativa"
              maxlength="255"
              rows="2"
              data-testid="justificativa-suspensao"
            />
          </div>
          <div v-if="pedeSenha" class="campo">
            <label for="presc-senha">{{ t('pep.presc.ver.senha') }}</label>
            <input
              id="presc-senha"
              v-model="senha"
              type="password"
              autocomplete="current-password"
              data-testid="senha-confirmacao"
            />
          </div>
          <MensagemErro v-if="erro" :erro="erro" />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('pep.presc.ver.confirmar')"
              tipo="submit"
              :desabilitado="!prontoParaConfirmar || ocupado"
              data-testid="confirmar-dialogo"
            />
            <SanteBotao :rotulo="t('pep.presc.ver.cancelar')" variante="texto" @acionar="dialogo = null" />
          </div>
        </form>
      </SanteDialogo>
    </template>
  </section>
</template>

<style scoped>
.tela {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.imprimir {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
tr.suspenso td,
tr.vencido td,
tr.suspenso-correcao td {
  color: var(--sgh-texto-secundario);
  text-decoration: line-through;
}
.horas {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.horas time {
  font-family: var(--sgh-fonte-codigo);
  margin-right: var(--sgh-espaco-1);
}
.secundario {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.marca {
  margin-left: var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
.prova.alterado {
  color: var(--sgh-alerta);
  font-weight: 700;
}
.obs {
  margin: var(--sgh-espaco-1) 0 0;
  color: var(--sgh-texto-secundario);
}
.dialogo,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
}
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.abas button {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-sutil);
  color: var(--sgh-texto);
}
.abas button[aria-selected='true'] {
  font-weight: 700;
  background: var(--sgh-fundo);
}
@media print {
  .nao-imprimir {
    display: none;
  }
}
</style>
