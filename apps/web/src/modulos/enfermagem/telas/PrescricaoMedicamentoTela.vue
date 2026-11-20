<script setup lang="ts">
// Prescrição de medicamento pelo enfermeiro (M45, etapa 4; ficha, seção 7 e regra 17; Res. COFEN 801/2026): na
// consulta de enfermagem, pelo protocolo publicado e com os medicamentos da lista do anexo II que ele permite; a prévia
// mostra a receita com o conteúdo mínimo do art. 3º e a impressão que a assinatura cobre; a assinatura é com a senha.
// Em `/enfermagem/prescricao-medicamento`, sem atendimento, as consultas de enfermagem do dia do enfermeiro.
import type { PreviaReceitaEnfermeiro } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  assinarReceita,
  inativarReceita,
  lerConsultasDeEnfermagem,
  lerPrescricaoEnfermeiro,
  previaReceita,
} from '../api-sae.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';

const props = withDefaults(defineProps<{ reg?: string }>(), { reg: '' });
const { t } = useI18n();
const atendimento = computed(() => Number(props.reg) || null);

const consultas = useQuery({
  queryKey: ['receita', 'consultas'],
  queryFn: () => lerConsultasDeEnfermagem(),
  enabled: computed(() => !atendimento.value),
});
const dados = useQuery({
  queryKey: computed(() => ['receita', atendimento.value]),
  queryFn: () => lerPrescricaoEnfermeiro(atendimento.value!),
  enabled: computed(() => !!atendimento.value),
});
const d = computed(() => dados.data.value);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

interface ItemForm {
  medicamento: string;
  via: string;
  posologia: string;
  quantidade: string;
}
const form = reactive<{
  protocolo: string;
  modelo: 'simples' | 'retencao';
  segundo: 'cpf' | 'nascimento';
  itens: ItemForm[];
}>({ protocolo: '', modelo: 'simples', segundo: 'nascimento', itens: [] });
const opcoesProtocolo = computed(() => [
  { valor: '', rotulo: '—' },
  ...(d.value?.protocolos ?? []).map((p) => ({
    valor: `${p.codigo}/${p.ano}`,
    rotulo: `${p.codigo}/${p.ano} · ${p.tipo}`,
  })),
]);
const protocolo = computed(() => d.value?.protocolos.find((p) => `${p.codigo}/${p.ano}` === form.protocolo));
const opcoesMedicamento = computed(() => [
  { valor: '', rotulo: '—' },
  ...(protocolo.value?.medicamentos ?? [])
    .filter((m) => d.value?.lista?.medicamentos.includes(m))
    .map((m) => ({ valor: m, rotulo: m })),
]);
const opcoesModelo = computed(() => [
  { valor: 'simples' as const, rotulo: t('enfermagem.receita.modelos.simples') },
  { valor: 'retencao' as const, rotulo: t('enfermagem.receita.modelos.retencao') },
]);
const opcoesSegundo = computed(() => [
  { valor: 'nascimento' as const, rotulo: t('enfermagem.receita.segundos.nascimento') },
  { valor: 'cpf' as const, rotulo: t('enfermagem.receita.segundos.cpf') },
]);
function adicionar(): void {
  form.itens.push({ medicamento: '', via: 'oral', posologia: '', quantidade: '' });
}
// W0-03: a reemissão aponta a receita suspensa ou cancelada (a nova cita a substituída e é assinada de novo).
const reemitindo = ref<number | null>(null);
const corpo = () => ({
  ...(reemitindo.value ? { anterior: reemitindo.value } : {}),
  protocolo: form.protocolo,
  modelo: form.modelo,
  segundoIdentificador: form.segundo,
  itens: form.itens.map((x) => ({ ...x })),
});
const pronta = computed(
  () =>
    !!form.protocolo &&
    form.itens.length > 0 &&
    form.itens.every(
      (x) =>
        x.medicamento && x.via.trim().length >= 2 && x.posologia.trim().length >= 5 && x.quantidade.trim(),
    ),
);

const previa = ref<PreviaReceitaEnfermeiro | null>(null);
const dialogo = ref(false);
const senha = ref('');
async function verPrevia(): Promise<void> {
  if (!atendimento.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    previa.value = await previaReceita(atendimento.value, corpo());
    senha.value = '';
    dialogo.value = true;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function assinar(): Promise<void> {
  if (!atendimento.value || !previa.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await assinarReceita(atendimento.value, {
      ...corpo(),
      impressaoVista: previa.value.impressao,
      senha: senha.value,
    });
    mensagem.value = r.mensagem;
    dialogo.value = false;
    form.itens = [];
    reemitindo.value = null;
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
function imprimir(): void {
  window.print();
}

// W0-03: suspender ou cancelar (motivo e senha; a original fica legível e inativa) e reemitir.
const inativando = ref<number | null>(null);
const dialogoInativar = ref(false);
const tipoInativacao = ref<'suspensao' | 'cancelamento'>('suspensao');
const opcoesInativacao = computed(() =>
  (['suspensao', 'cancelamento'] as const).map((v) => ({
    valor: v,
    rotulo: t(`enfermagem.correcao.receita.tipos.${v}`),
  })),
);
function abrirInativar(id: number): void {
  inativando.value = id;
  tipoInativacao.value = 'suspensao';
  dialogoInativar.value = true;
}
async function inativar(c: DadosCorrecao): Promise<void> {
  if (!atendimento.value || inativando.value === null) return;
  const r = await inativarReceita(atendimento.value, inativando.value, {
    tipo: tipoInativacao.value,
    motivo: c.motivo,
    senha: c.senha,
  });
  mensagem.value = r.mensagem;
  await dados.refetch();
}
function reemitir(r: {
  id: number;
  protocolo: string;
  ano: number;
  modelo: 'simples' | 'retencao';
  segundoIdentificador: 'cpf' | 'nascimento';
  itens: readonly { medicamento: string; via: string; posologia: string; quantidade: string }[];
}): void {
  reemitindo.value = r.id;
  form.protocolo = `${r.protocolo}/${r.ano}`;
  form.modelo = r.modelo;
  form.segundo = r.segundoIdentificador;
  form.itens = r.itens.map((x) => ({ ...x }));
  mensagem.value = null;
}
const hora = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');
</script>

<template>
  <section class="tela-enf" aria-labelledby="receita-titulo" data-testid="tela-receita">
    <h1 id="receita-titulo">{{ t('enfermagem.receita.titulo') }}</h1>
    <p>{{ t('enfermagem.receita.texto') }}</p>

    <template v-if="!atendimento">
      <h2>{{ t('enfermagem.receita.consultas') }}</h2>
      <ErroEnfermagem v-if="consultas.isError.value" :erro="consultas.error.value" />
      <p v-else-if="consultas.data.value?.length === 0">{{ t('enfermagem.receita.semConsultas') }}</p>
      <ul data-testid="receita-consultas">
        <li v-for="c in consultas.data.value ?? []" :key="c.atendimento">
          {{ c.nome }} · {{ t('enfermagem.receita.atendimento', { numero: c.numero }) }}
          <RouterLink
            :to="`/enfermagem/prescricao-medicamento/${c.atendimento}`"
            :data-testid="`receita-abrir-${c.atendimento}`"
            >{{ t('enfermagem.receita.abrir') }}</RouterLink
          >
        </li>
      </ul>
    </template>

    <template v-else>
      <ErroEnfermagem v-if="dados.isError.value" :erro="dados.error.value" />
      <p v-else-if="!d" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <template v-else>
        <p class="cabecalho" data-testid="receita-cabecalho">
          <strong>{{ d.nome }}</strong> · {{ t('enfermagem.receita.atendimento', { numero: d.numero }) }}
        </p>
        <SanteAlerta
          v-if="!d.gravacao.ligada"
          variante="aviso"
          :texto="t('enfermagem.receita.desligado', { motivo: d.gravacao.motivo ?? '' })"
        />
        <SanteAlerta
          v-if="!d.consultaDeEnfermagem"
          variante="aviso"
          :texto="t('enfermagem.receita.foraDaConsulta', { motivo: d.motivo ?? '' })"
          data-testid="receita-fora"
        />
        <SanteAlerta v-if="!d.lista" variante="aviso" :texto="t('enfermagem.receita.semLista')" />
        <p v-if="mensagem" role="status" data-testid="receita-mensagem">{{ mensagem }}</p>
        <ErroEnfermagem v-if="erro && !dialogo" :erro="erro" />

        <form
          v-if="d.gravacao.prescrever"
          class="cartao"
          data-testid="receita-form"
          @submit.prevent="verPrevia"
        >
          <p v-if="reemitindo" class="alerta barra" data-testid="receita-reemitindo">
            {{ t('enfermagem.correcao.receita.reemitindo', { id: reemitindo }) }}
            <SanteBotao
              variante="texto"
              :rotulo="t('enfermagem.correcao.receita.cancelarReemissao')"
              @acionar="reemitindo = null"
            />
          </p>
          <SanteSelecao
            v-model="form.protocolo"
            :rotulo="t('enfermagem.receita.protocolo')"
            :opcoes="opcoesProtocolo"
            data-testid="receita-protocolo"
          />
          <SanteOpcoes
            v-model="form.modelo"
            :legenda="t('enfermagem.receita.modelo')"
            :opcoes="opcoesModelo"
          />
          <SanteOpcoes
            v-model="form.segundo"
            :legenda="t('enfermagem.receita.segundo')"
            :opcoes="opcoesSegundo"
          />
          <div v-for="(x, i) in form.itens" :key="i" class="barra" :data-testid="`receita-item-${i}`">
            <SanteSelecao
              v-model="x.medicamento"
              :rotulo="t('enfermagem.receita.medicamento')"
              :opcoes="opcoesMedicamento"
              :data-testid="`receita-medicamento-${i}`"
            />
            <SanteCampoTexto
              :id="`receita-via-${i}`"
              v-model="x.via"
              :rotulo="t('enfermagem.receita.via')"
              :max-bytes="30"
            />
            <SanteCampoTexto
              :id="`receita-posologia-${i}`"
              v-model="x.posologia"
              :rotulo="t('enfermagem.receita.posologia')"
              :max-bytes="200"
              :data-testid="`receita-posologia-${i}`"
            />
            <SanteCampoTexto
              :id="`receita-quantidade-${i}`"
              v-model="x.quantidade"
              :rotulo="t('enfermagem.receita.quantidade')"
              :max-bytes="60"
              :data-testid="`receita-quantidade-${i}`"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('enfermagem.receita.remover')"
              @acionar="form.itens.splice(i, 1)"
            />
          </div>
          <div class="barra">
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.receita.adicionar')"
              data-testid="receita-adicionar"
              @acionar="adicionar"
            />
            <SanteBotao
              tipo="submit"
              :rotulo="t('enfermagem.receita.previa')"
              :desabilitado="!pronta || ocupado"
              data-testid="receita-previa"
            />
          </div>
        </form>

        <section aria-labelledby="receita-emitidas">
          <h2 id="receita-emitidas">{{ t('enfermagem.receita.receitas') }}</h2>
          <p v-if="d.receitas.length === 0">{{ t('enfermagem.receita.semReceitas') }}</p>
          <article
            v-for="r in d.receitas"
            :key="r.id"
            class="cartao"
            :class="{ inativo: !!r.inativacao }"
            :data-testid="`receita-${r.id}`"
            :data-inativa="r.inativacao ? 'sim' : 'nao'"
          >
            <p v-if="r.inativacao" class="alerta" :data-testid="`receita-inativacao-${r.id}`">
              <strong>{{ t(`enfermagem.correcao.receita.tipoCurto.${r.inativacao.tipo}`) }}</strong> ·
              {{
                t('enfermagem.correcao.receita.inativada', {
                  tipo: t(`enfermagem.correcao.receita.tipoCurto.${r.inativacao.tipo}`),
                  por: r.inativacao.usuario,
                  quando: hora(r.inativacao.em),
                  motivo: r.inativacao.motivo,
                })
              }}
            </p>
            <p v-if="r.anterior" class="secundario" :data-testid="`receita-anterior-${r.id}`">
              {{ t('enfermagem.correcao.receita.substitui', { id: r.anterior }) }}
            </p>
            <p v-if="r.reemitidaEm" class="secundario">
              {{ t('enfermagem.correcao.receita.reemitidaEm', { id: r.reemitidaEm }) }}
            </p>
            <pre class="receita">{{ r.texto }}</pre>
            <p class="secundario">{{ t('enfermagem.receita.impressao', { h: r.impressao.slice(0, 16) }) }}</p>
            <div class="barra">
              <SanteBotao
                v-if="!r.inativacao"
                variante="secundario"
                :rotulo="t('enfermagem.receita.imprimir')"
                @acionar="imprimir"
              />
              <SanteBotao
                v-if="!r.inativacao"
                variante="secundario"
                :rotulo="t('enfermagem.correcao.receita.inativar')"
                :desabilitado="!d.gravacao.prescrever"
                :data-testid="`receita-inativar-${r.id}`"
                @acionar="abrirInativar(r.id)"
              />
              <SanteBotao
                v-if="r.inativacao && !r.reemitidaEm"
                variante="secundario"
                :rotulo="t('enfermagem.correcao.receita.reemitir')"
                :desabilitado="!d.gravacao.prescrever"
                :data-testid="`receita-reemitir-${r.id}`"
                @acionar="reemitir(r)"
              />
            </div>
          </article>
        </section>
      </template>
    </template>

    <DialogoCorrecao
      v-model:visivel="dialogoInativar"
      :titulo="t('enfermagem.correcao.receita.titulo')"
      :texto="t('enfermagem.correcao.receita.texto')"
      com-senha
      testid="receita-dialogo-inativar"
      :executar="inativar"
    >
      <SanteOpcoes
        v-model="tipoInativacao"
        :legenda="t('enfermagem.correcao.tipo')"
        :opcoes="opcoesInativacao"
        nome="receita-inativacao-tipo"
      />
    </DialogoCorrecao>
    <SanteDialogo v-model:visivel="dialogo" :titulo="t('enfermagem.receita.previaTitulo')" largura="44rem">
      <div class="campo">
        <pre class="receita" data-testid="receita-texto">{{ previa?.texto }}</pre>
        <p class="secundario">
          {{ t('enfermagem.receita.impressao', { h: previa?.impressao.slice(0, 16) ?? '' }) }}
        </p>
        <label for="receita-senha">{{ t('enfermagem.receita.senha') }}</label>
        <input
          id="receita-senha"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          data-testid="receita-senha"
        />
        <ErroEnfermagem v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao
          :rotulo="t('enfermagem.receita.assinar')"
          :desabilitado="!senha || ocupado"
          data-testid="receita-assinar"
          @acionar="assinar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.receita {
  white-space: pre-wrap;
  font-family: inherit;
}
</style>
