<script setup lang="ts">
// Acompanhantes com direito legal (M50, etapa 5; item `Hotelaria e apoio > Portaria e visitantes > Acompanhantes com
// direito legal`; `hotelaria.acompanhante.registrar`): por unidade, o acompanhante vigente de cada paciente com o
// fundamento (pessoa idosa, criança ou adolescente, parturiente, pessoa com deficiência ou autorizado pela equipe), o
// direito à refeição (o mapa de dietas da nutrição lê; só com direito legal) e o pernoite; registrar, trocar (o
// anterior é encerrado) e encerrar com o motivo. A pessoa é buscada ou cadastrada (cadastro mínimo) aqui mesmo, pela
// permissão do acompanhante. O acompanhante com direito legal entra pela portaria fora do horário de visita e do limite
// da unidade; o autorizado pela equipe segue a regra da unidade.
import type { FundamentoAcompanhante, TipoDocumentoVisitante, VisitanteLido } from '@sgh/contratos';
import { FUNDAMENTOS_ACOMPANHANTE, TIPOS_DOCUMENTO_VISITANTE } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarPessoasAcompanhante,
  encerrarAcompanhante,
  lerAcompanhantes,
  registrarAcompanhante,
  registrarPessoaAcompanhante,
} from '../api-portaria.js';
import ErroPortaria from '../componentes/ErroPortaria.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const unidade = ref('');
const painel = useQuery({
  queryKey: computed(() => ['portaria', 'acompanhantes', unidade.value]),
  queryFn: () => lerAcompanhantes(unidade.value || null),
});
const p = computed(() => painel.data.value);
const pode = computed(() => p.value?.gravacao.operacoes['acompanhante']?.pode === true);
const erro = ref<unknown>(null);
const mensagem = ref('');
const aviso = ref<string | null>(null);
const hora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: t('portaria.acompanhantes.todas') },
  ...(p.value?.unidades ?? []).map((u) => ({ valor: u.unidade, rotulo: u.nome })),
]);
const internacao = ref<number | null>(null);
const opcoesPaciente = computed(() => [
  { valor: null, rotulo: '—' },
  ...(p.value?.internados ?? []).map((i) => ({
    valor: i.internacao as number | null,
    rotulo: `${i.leito} · ${i.nome}`,
  })),
]);
const fundamento = ref<FundamentoAcompanhante>('idoso');
const opcoesFundamento = computed(() =>
  FUNDAMENTOS_ACOMPANHANTE.map((f) => ({ valor: f, rotulo: t(`portaria.fundamentos.${f}`) })),
);
const refeicao = ref(true);
// A refeição do acompanhante é do direito legal: o autorizado pela equipe não a tem.
watch(fundamento, (f) => {
  if (f === 'autorizado') refeicao.value = false;
});
const pernoite = ref(true);
const observacao = ref('');
const busca = ref('');
const pessoas = ref<VisitanteLido[]>([]);
const pessoa = ref<number | null>(null);
async function buscarPessoa(): Promise<void> {
  try {
    pessoas.value = await buscarPessoasAcompanhante({ busca: busca.value });
  } catch (x) {
    erro.value = x;
  }
}
const cadastrando = ref(false);
const nova = ref({
  nome: '',
  tipoDocumento: 'cpf' as TipoDocumentoVisitante,
  documento: '',
  nascimento: '',
  tipoVisitante: null as number | null,
});
const opcoesDocumento = computed(() =>
  TIPOS_DOCUMENTO_VISITANTE.map((d) => ({ valor: d, rotulo: t(`portaria.documentos.${d}`) })),
);
const opcoesTipoVisitante = computed(() => [
  { valor: null, rotulo: '—' },
  ...(p.value?.tiposVisitante ?? []).map((x) => ({ valor: x.codigo as number | null, rotulo: x.nome })),
]);
async function cadastrarPessoa(): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (
      await registrarPessoaAcompanhante({
        nome: nova.value.nome,
        tipoDocumento: nova.value.tipoDocumento,
        documento: nova.value.documento,
        nascimento: nova.value.nascimento || null,
        tipoVisitante: nova.value.tipoVisitante,
      })
    ).mensagem;
    pessoas.value = await buscarPessoasAcompanhante({
      tipo: nova.value.tipoDocumento,
      documento: nova.value.documento,
    });
    pessoa.value = pessoas.value[0]?.id ?? null;
    cadastrando.value = false;
  } catch (x) {
    erro.value = x;
  }
}
const opcoesPessoas = computed(() => [
  { valor: null, rotulo: '—' },
  ...pessoas.value.map((v) => ({
    valor: v.id as number | null,
    rotulo: `${v.nome} · ${v.documentoMascarado}`,
  })),
]);
async function registrar(): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    const r = await registrarAcompanhante({
      internacao: internacao.value,
      visitante: pessoa.value,
      fundamento: fundamento.value,
      refeicao: refeicao.value,
      pernoite: pernoite.value,
      observacao: observacao.value.trim() || null,
    });
    mensagem.value = r.mensagem;
    aviso.value = r.aviso;
    await cliente.invalidateQueries({ queryKey: ['portaria', 'acompanhantes'] });
  } catch (x) {
    erro.value = x;
  }
}
const encerrando = ref<number | null>(null);
const motivo = ref('');
const dialogo = computed({
  get: () => encerrando.value !== null,
  set: (v: boolean) => {
    if (!v) encerrando.value = null;
  },
});
async function encerrar(): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (await encerrarAcompanhante(encerrando.value!, motivo.value)).mensagem;
    encerrando.value = null;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['portaria', 'acompanhantes'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-portaria" aria-labelledby="ac-titulo" data-testid="tela-acompanhantes">
    <h1 id="ac-titulo">{{ t('portaria.acompanhantes.titulo') }}</h1>
    <p>{{ t('portaria.acompanhantes.subtitulo') }}</p>
    <nav class="barra" :aria-label="t('portaria.navegacao')">
      <RouterLink to="/portaria">{{ t('portaria.links.portaria') }}</RouterLink>
    </nav>
    <p v-if="painel.isLoading.value">{{ t('portaria.carregando') }}</p>
    <ErroPortaria v-else-if="painel.error.value" :erro="painel.error.value" />
    <template v-else-if="p">
      <SanteAlerta
        v-if="!p.gravacao.ligada"
        variante="info"
        :texto="p.gravacao.motivo ?? t('portaria.desligada')"
      />
      <p v-if="mensagem" role="status" data-testid="ac-mensagem">{{ mensagem }}</p>
      <SanteAlerta v-if="aviso" variante="aviso" :texto="aviso" />
      <ErroPortaria v-if="erro" :erro="erro" />
      <SanteSelecao
        v-model="unidade"
        :rotulo="t('portaria.regras.unidade')"
        :opcoes="opcoesUnidade"
        data-testid="ac-unidade"
      />
      <form v-if="unidade" class="cartao registro" data-testid="ac-form" @submit.prevent="registrar">
        <h2>{{ t('portaria.acompanhantes.registrar') }}</h2>
        <div class="campos">
          <SanteSelecao
            v-model="internacao"
            :rotulo="t('portaria.bloqueios.paciente')"
            :opcoes="opcoesPaciente"
            data-testid="ac-paciente"
          />
          <SanteSelecao
            v-model="fundamento"
            :rotulo="t('portaria.acompanhantes.fundamento')"
            :opcoes="opcoesFundamento"
            data-testid="ac-fundamento"
          />
        </div>
        <div class="barra">
          <span class="campo">
            <label for="ac-busca">{{ t('portaria.bloqueios.buscaPessoa') }}</label>
            <input id="ac-busca" v-model="busca" maxlength="70" data-testid="ac-busca" />
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('portaria.visitante.buscar')"
            :desabilitado="busca.trim().length < 3"
            data-testid="ac-buscar"
            @acionar="buscarPessoa"
          />
          <SanteSelecao
            v-model="pessoa"
            :rotulo="t('portaria.bloqueios.pessoa')"
            :opcoes="opcoesPessoas"
            data-testid="ac-pessoa"
          />
        </div>
        <p class="secundario">
          {{ t('portaria.acompanhantes.cadastroNaPortaria') }}
          <SanteBotao
            variante="texto"
            :rotulo="t('portaria.acompanhantes.novaPessoa')"
            :desabilitado="!pode"
            data-testid="ac-nova-pessoa"
            @acionar="cadastrando = true"
          />
        </p>
        <div v-if="cadastrando" class="campos" data-testid="ac-form-pessoa">
          <span class="campo">
            <label for="ac-nome">{{ t('portaria.visitante.nome') }}</label>
            <input id="ac-nome" v-model="nova.nome" maxlength="70" data-testid="ac-nome" />
          </span>
          <SanteSelecao
            v-model="nova.tipoDocumento"
            :rotulo="t('portaria.visitante.tipoDocumento')"
            :opcoes="opcoesDocumento"
          />
          <span class="campo">
            <label for="ac-documento">{{ t('portaria.visitante.documento') }}</label>
            <input id="ac-documento" v-model="nova.documento" maxlength="20" data-testid="ac-documento" />
          </span>
          <span class="campo">
            <label for="ac-nascimento">{{ t('portaria.visitante.nascimento') }}</label>
            <input id="ac-nascimento" v-model="nova.nascimento" type="date" />
          </span>
          <SanteSelecao
            v-model="nova.tipoVisitante"
            :rotulo="t('portaria.visitante.tipo')"
            :opcoes="opcoesTipoVisitante"
            data-testid="ac-tipo-visitante"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('portaria.acompanhantes.gravarPessoa')"
            :desabilitado="
              !pode ||
              nova.nome.trim().length < 3 ||
              nova.documento.trim().length < 3 ||
              nova.tipoVisitante === null
            "
            data-testid="ac-gravar-pessoa"
            @acionar="cadastrarPessoa"
          />
        </div>
        <div class="barra">
          <label class="barra"
            ><input
              v-model="refeicao"
              type="checkbox"
              :disabled="fundamento === 'autorizado'"
              data-testid="ac-refeicao"
            />
            {{ t('portaria.acompanhantes.refeicao') }}</label
          >
          <span v-if="fundamento === 'autorizado'" class="secundario">{{
            t('portaria.acompanhantes.semRefeicaoAutorizado')
          }}</span>
          <label class="barra"
            ><input v-model="pernoite" type="checkbox" /> {{ t('portaria.acompanhantes.pernoite') }}</label
          >
        </div>
        <span class="campo">
          <label for="ac-obs">{{ t('portaria.regras.observacao') }}</label>
          <input id="ac-obs" v-model="observacao" maxlength="200" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portaria.acompanhantes.registrar')"
          :desabilitado="!pode || internacao === null || pessoa === null"
          data-testid="ac-registrar"
        />
      </form>
      <p v-if="p.acompanhantes.length === 0">{{ t('portaria.acompanhantes.nenhum') }}</p>
      <div v-else class="rolagem">
        <table class="grade" data-testid="ac-lista">
          <thead>
            <tr>
              <th scope="col">{{ t('portaria.bloqueios.paciente') }}</th>
              <th scope="col">{{ t('portaria.acompanhantes.acompanhante') }}</th>
              <th scope="col">{{ t('portaria.acompanhantes.fundamento') }}</th>
              <th scope="col">{{ t('portaria.acompanhantes.refeicao') }}</th>
              <th scope="col">{{ t('portaria.acompanhantes.desde') }}</th>
              <th scope="col">{{ t('portaria.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in p.acompanhantes" :key="x.id" :data-testid="`ac-${x.internacao}`">
              <td>{{ x.paciente }} · {{ x.unidadeNome }} · {{ x.leito }}</td>
              <td>
                {{ x.visitante.nome
                }}<span v-if="x.substitui" class="secundario">
                  · {{ t('portaria.acompanhantes.troca') }}</span
                >
              </td>
              <td>{{ t(`portaria.fundamentos.${x.fundamento}`) }}</td>
              <td>
                {{ x.refeicao ? t('portaria.sim') : t('portaria.nao') }}
                <span v-if="x.pernoite" class="secundario">
                  · {{ t('portaria.acompanhantes.pernoite') }}</span
                >
              </td>
              <td>{{ hora(x.inicio) }}</td>
              <td>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('portaria.acompanhantes.encerrar')"
                  :desabilitado="!pode"
                  @acionar="encerrando = x.id"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <SanteDialogo v-model:visivel="dialogo" :titulo="t('portaria.acompanhantes.encerrar')">
      <div class="campo">
        <label for="ac-motivo">{{ t('portaria.acompanhantes.motivoFim') }}</label>
        <input id="ac-motivo" v-model="motivo" maxlength="200" />
        <SanteBotao
          :rotulo="t('portaria.confirmar')"
          :desabilitado="motivo.trim().length < 10"
          @acionar="encerrar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="../estilo-portaria.css"></style>
