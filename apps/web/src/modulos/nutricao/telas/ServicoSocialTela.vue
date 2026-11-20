<script setup lang="ts">
// Avaliação social (ficha do M45, seção 7; regra 13): `/servico-social/:reg`. Os registros do serviço social da internação
// (o parecer só para a assistente social; a equipe com vínculo vê que houve registro, o risco, as vulnerabilidades, os
// encaminhamentos e as orientações), as barreiras de alta abertas e o registro novo pela assistente social, com o risco
// nunca abaixo do calculado e a barreira social de alta enviada ao NIR na mesma gravação.
// W0-05: cada registro num cartão com a situação (ativo ou estornado, inativo e visível com quem, quando e o motivo); o
// adendo (qualquer assistente social; o original continua ativo) e o estorno (só o próprio autor) pelo diálogo de
// correção, com o motivo obrigatório. A impressão sai com os registros estornados.
import {
  type RegistroSocialLido,
  type ResultadoCorrecao,
  CODIGOS_REDE_APOIO,
  CODIGOS_RISCO_SOCIAL,
  CODIGOS_TIPO_SOCIAL,
  ENCAMINHAMENTOS_SOCIAIS,
  type EncaminhamentoSocial,
  type RedeApoio,
  type RiscoSocial,
  type TipoRegistroSocial,
  VULNERABILIDADES_SOCIAIS,
  type VulnerabilidadeSocial,
} from '@sgh/contratos';
import { riscoSocialCalculado } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  adendoSocial,
  estornarSocial,
  lerGravacaoSocial,
  lerServicoSocial,
  novaChaveNutricao,
  registrarSocial,
} from '../api-nutricao.js';
import AvisoNutricao from '../componentes/AvisoNutricao.vue';
import DialogoCorrecao from '../componentes/DialogoCorrecao.vue';
import ErroNutricao from '../componentes/ErroNutricao.vue';
import { dataLonga, instanteCurto, leitoTexto } from '../regras-nutricao.js';

const { t } = useI18n();
const rota = useRoute();
const reg = computed(() => Number(rota.params['reg']));
const gravacao = useQuery({
  queryKey: ['servico-social', 'gravacao'],
  queryFn: lerGravacaoSocial,
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['registrar']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['registrar']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const dados = useQuery({
  queryKey: computed(() => ['servico-social', 'paciente', reg.value]),
  queryFn: () => lerServicoSocial(reg.value),
});

const tipo = ref<TipoRegistroSocial>('avaliacao');
const rede = ref<RedeApoio>('presente');
const vulnerabilidades = ref<VulnerabilidadeSocial[]>([]);
const encaminhamentos = ref<EncaminhamentoSocial[]>([]);
const risco = ref<RiscoSocial>('baixo');
const parecer = ref('');
const orientacoes = ref('');
const comBarreira = ref(false);
const barreiraDescricao = ref('');
const barreiraResponsavel = ref('Serviço social');
const barreiraPrazo = ref<string | null>(null);
const calculado = computed(() => riscoSocialCalculado(rede.value, vulnerabilidades.value));
const ORDEM: Record<RiscoSocial, number> = { baixo: 0, medio: 1, alto: 2 };
watch(calculado, (c) => {
  if (ORDEM[risco.value] < ORDEM[c]) risco.value = c;
});
const tipos = computed(() =>
  CODIGOS_TIPO_SOCIAL.map((x) => ({ valor: x, rotulo: t(`nutricao.social.tipos.${x}`) })),
);
const redes = computed(() =>
  CODIGOS_REDE_APOIO.map((x) => ({ valor: x, rotulo: t(`nutricao.social.redes.${x}`) })),
);
const riscos = computed(() =>
  CODIGOS_RISCO_SOCIAL.map((x) => ({ valor: x, rotulo: t(`nutricao.social.riscos.${x}`) })),
);
const encaminhamentosOpcoes = ENCAMINHAMENTOS_SOCIAIS;

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarSocial(
      {
        internacao: reg.value,
        tipo: tipo.value,
        redeApoio: rede.value,
        vulnerabilidades: vulnerabilidades.value,
        risco: risco.value,
        encaminhamentos: encaminhamentos.value,
        parecer: parecer.value,
        ...(orientacoes.value.trim() ? { orientacoes: orientacoes.value.trim() } : {}),
        barreira: comBarreira.value
          ? {
              descricao: barreiraDescricao.value,
              responsavel: barreiraResponsavel.value,
              prazo: barreiraPrazo.value,
            }
          : null,
      },
      novaChaveNutricao('social'),
    );
    mensagem.value = r.mensagem;
    parecer.value = '';
    comBarreira.value = false;
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
// ── W0-05: adendo e estorno ──
const { sessao } = usarSessao();
const login = computed(() => (sessao.value?.usuario.login ?? sessao.value?.usuario.id ?? '').toUpperCase());
const acao = ref<{ tipo: 'adendo' | 'estornar'; registro: RegistroSocialLido } | null>(null);
const dialogo = ref(false);
const textoAdendo = ref('');
function abrir(tipo: 'adendo' | 'estornar', registro: RegistroSocialLido): void {
  acao.value = { tipo, registro };
  textoAdendo.value = '';
  dialogo.value = true;
}
function gravarAcao({ motivo }: { motivo: string }): Promise<ResultadoCorrecao> {
  const a = acao.value;
  if (!a) return Promise.reject(new Error('sem ação'));
  return a.tipo === 'adendo'
    ? adendoSocial(
        a.registro.id,
        { texto: textoAdendo.value.trim(), motivo },
        novaChaveNutricao('adendo-social'),
      )
    : estornarSocial(a.registro.id, motivo, novaChaveNutricao('estornar-social'));
}
async function feito(r: unknown): Promise<void> {
  erro.value = null;
  mensagem.value = (r as ResultadoCorrecao).mensagem;
  await dados.refetch();
}
const emDe = (id: number | null) =>
  instanteCurto(dados.data.value?.registros.find((r) => r.id === id)?.em ?? '');
const imprimir = () => window.print();
const nomeVulnerabilidade = (c: string) => VULNERABILIDADES_SOCIAIS.find((v) => v.codigo === c)?.rotulo ?? c;
const nomeEncaminhamento = (c: string) => ENCAMINHAMENTOS_SOCIAIS.find((v) => v.codigo === c)?.rotulo ?? c;
</script>

<template>
  <section
    class="tela-agenda tela-correcoes"
    aria-labelledby="social-titulo"
    data-testid="tela-servico-social"
  >
    <ErroNutricao v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('nutricao.carregando') }}</p>
    <template v-else>
      <h1 id="social-titulo">{{ t('nutricao.social.paciente', { nome: dados.data.value.nome }) }}</h1>
      <p class="secundario">
        {{ leitoTexto(dados.data.value.leito) }} · {{ t('nutricao.admissao') }}
        {{ instanteCurto(dados.data.value.admissao) }}
        <span v-if="dados.data.value.idade !== null">
          · {{ t('nutricao.idade', { n: dados.data.value.idade }) }}</span
        >
      </p>
      <p class="acoes">
        <RouterLink to="/servico-social">{{ t('nutricao.atalhos.social') }}</RouterLink>
        <RouterLink to="/internacao/nir/altas-previstas">{{ t('nutricao.atalhos.nir') }}</RouterLink>
      </p>
      <AvisoNutricao :motivo="aviso" />
      <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="social-mensagem" />
      <section class="painel" aria-labelledby="social-barreiras">
        <h2 id="social-barreiras">{{ t('nutricao.social.barreirasAbertas') }}</h2>
        <p v-if="dados.data.value.barreiras.length === 0">{{ t('nutricao.nenhum') }}</p>
        <ul v-else class="lista-simples" data-testid="social-barreiras">
          <li v-for="b in dados.data.value.barreiras" :key="b.id">
            {{ b.descricao }} · {{ b.responsavel }} · {{ dataLonga(b.prazo) }}
            <strong v-if="b.vencida"> · {{ t('nutricao.social.vencida') }}</strong>
          </li>
        </ul>
      </section>
      <section class="painel" aria-labelledby="social-registros">
        <div class="cabeca-registro">
          <h2 id="social-registros">{{ t('nutricao.social.registros') }}</h2>
          <SanteBotao
            class="nao-imprimir"
            variante="secundario"
            :rotulo="t('nutricao.correcao.imprimir')"
            :title="t('nutricao.correcao.imprimirAjuda')"
            data-testid="social-imprimir"
            @acionar="imprimir"
          />
        </div>
        <p v-if="dados.data.value.registros.length === 0">{{ t('nutricao.social.semRegistros') }}</p>
        <article
          v-for="r in dados.data.value.registros"
          :key="r.id"
          :class="['cartao-registro', { inativo: r.situacao !== 'ativo' }]"
          :data-testid="`social-registro-${r.id}`"
          :data-situacao="r.situacao"
        >
          <p class="cabeca-registro">
            <span
              :class="['pilula', r.situacao === 'ativo' ? 'pilula--ok' : 'pilula--alerta']"
              :data-testid="`social-situacao-${r.id}`"
              >{{ t(`nutricao.social.situacoes.${r.situacao}`) }}</span
            >
            <strong :class="{ riscado: r.situacao !== 'ativo' }">{{
              t('nutricao.social.linha', {
                tipo: t(`nutricao.social.tipos.${r.tipo}`),
                risco: t(`nutricao.social.riscos.${r.risco}`),
                rede: t(`nutricao.social.redes.${r.redeApoio}`),
                por: r.por,
                em: instanteCurto(r.em),
              })
            }}</strong>
          </p>
          <p v-if="r.adendoDe" class="nota-correcao">
            {{ t('nutricao.social.adendoDe', { em: emDe(r.adendoDe) }) }}
            <span v-if="r.motivoAdendo">
              · {{ t('nutricao.social.adendoMotivo', { motivo: r.motivoAdendo }) }}</span
            >
          </p>
          <p v-if="r.correcao" class="nota-correcao" :data-testid="`social-correcao-${r.id}`">
            {{
              t('nutricao.correcao.estornado', {
                em: instanteCurto(r.correcao.em),
                por: r.correcao.por,
                motivo: r.correcao.motivo,
              })
            }}
          </p>
          <p v-if="r.vulnerabilidades.length">
            {{ t('nutricao.social.vulnerabilidades') }}:
            {{ r.vulnerabilidades.map(nomeVulnerabilidade).join('; ') }}
          </p>
          <p v-if="r.encaminhamentos.length">
            {{ t('nutricao.social.encaminhamentos') }}:
            {{ r.encaminhamentos.map(nomeEncaminhamento).join('; ') }}
          </p>
          <p v-if="r.sigilo" class="secundario" data-testid="social-sigilo">
            {{ t('nutricao.social.sigilo') }}
          </p>
          <p v-else class="parecer" data-testid="social-parecer">{{ r.parecer }}</p>
          <p v-if="r.orientacoes">{{ t('nutricao.social.orientacoes') }}: {{ r.orientacoes }}</p>
          <p v-if="pode && r.situacao === 'ativo'" class="acoes-registro nao-imprimir">
            <SanteBotao
              variante="secundario"
              :rotulo="t('nutricao.social.adendo')"
              :data-testid="`social-adendo-${r.id}`"
              @acionar="abrir('adendo', r)"
            />
            <SanteBotao
              v-if="r.por.toUpperCase() === login"
              variante="texto"
              :rotulo="t('nutricao.social.estornar')"
              :data-testid="`social-estornar-${r.id}`"
              @acionar="abrir('estornar', r)"
            />
          </p>
        </article>
      </section>
      <section class="painel" aria-labelledby="social-novo">
        <h2 id="social-novo">{{ t('nutricao.social.novo') }}</h2>
        <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
        <form v-else class="formulario" data-testid="form-social" @submit.prevent="gravar">
          <div class="grade">
            <SanteSelecao v-model="tipo" :rotulo="t('nutricao.social.tipo')" :opcoes="tipos" />
            <SanteSelecao
              v-model="rede"
              :rotulo="t('nutricao.social.rede')"
              :opcoes="redes"
              data-testid="social-rede"
            />
          </div>
          <fieldset class="marcas">
            <legend>{{ t('nutricao.social.vulnerabilidades') }}</legend>
            <label v-for="v in VULNERABILIDADES_SOCIAIS" :key="v.codigo">
              <input v-model="vulnerabilidades" type="checkbox" :value="v.codigo" />
              {{ v.rotulo }}
            </label>
          </fieldset>
          <fieldset class="marcas">
            <legend>{{ t('nutricao.social.encaminhamentos') }}</legend>
            <label v-for="v in encaminhamentosOpcoes" :key="v.codigo">
              <input v-model="encaminhamentos" type="checkbox" :value="v.codigo" />
              {{ v.rotulo }}
            </label>
          </fieldset>
          <SanteSelecao
            v-model="risco"
            :rotulo="t('nutricao.social.risco')"
            :opcoes="riscos"
            data-testid="social-risco"
          />
          <p class="secundario" data-testid="social-risco-calculado">
            {{ t('nutricao.social.riscoCalculado', { risco: t(`nutricao.social.riscos.${calculado}`) }) }}
          </p>
          <SanteCampoTexto
            v-model="parecer"
            :rotulo="t('nutricao.social.parecer')"
            :max-bytes="4000"
            multilinha
            obrigatorio
            data-testid="social-parecer-campo"
          />
          <SanteCampoTexto
            v-model="orientacoes"
            :rotulo="t('nutricao.social.orientacoes')"
            :max-bytes="500"
          />
          <label class="opcao">
            <input v-model="comBarreira" type="checkbox" data-testid="social-com-barreira" />
            {{ t('nutricao.social.comBarreira') }}
          </label>
          <div v-if="comBarreira" class="grade">
            <SanteCampoTexto
              v-model="barreiraDescricao"
              :rotulo="t('nutricao.social.barreiraDescricao')"
              :max-bytes="300"
              data-testid="social-barreira-descricao"
            />
            <SanteCampoTexto
              v-model="barreiraResponsavel"
              :rotulo="t('nutricao.social.barreiraResponsavel')"
              :max-bytes="60"
            />
            <SanteData v-model="barreiraPrazo" :rotulo="t('nutricao.social.barreiraPrazo')" editavel />
          </div>
          <ErroNutricao v-if="erro" :erro="erro" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('nutricao.social.gravar')"
            :desabilitado="ocupado || parecer.trim().length < 20 || (comBarreira && !barreiraPrazo)"
            data-testid="social-gravar"
          />
        </form>
      </section>
      <DialogoCorrecao
        v-model:visivel="dialogo"
        :titulo="
          acao?.tipo === 'adendo' ? t('nutricao.social.adendoTitulo') : t('nutricao.social.estornarTitulo')
        "
        :texto="
          acao?.tipo === 'adendo' ? t('nutricao.social.adendoTexto') : t('nutricao.social.estornarTexto')
        "
        :confirmar="acao?.tipo === 'adendo' ? t('nutricao.social.adendo') : t('nutricao.social.estornar')"
        :incompleto="acao?.tipo === 'adendo' && textoAdendo.trim().length < 5"
        :gravar="gravarAcao"
        @feito="feito"
      >
        <SanteCampoTexto
          v-if="acao?.tipo === 'adendo'"
          v-model="textoAdendo"
          :rotulo="t('nutricao.social.adendoCampo')"
          :max-bytes="4000"
          multilinha
          obrigatorio
          data-testid="social-adendo-texto"
        />
      </DialogoCorrecao>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-correcao.css"></style>
<style scoped>
.formulario {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.marcas {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.marcas legend {
  font-weight: 600;
}
.registro {
  border-bottom: 1px solid var(--sgh-borda);
  padding-bottom: var(--sgh-espaco-2);
}
.registro p {
  margin: var(--sgh-espaco-1) 0;
}
.parecer {
  white-space: pre-wrap;
}
.lista-simples {
  margin: 0;
  padding-inline-start: var(--sgh-espaco-3);
}
</style>
